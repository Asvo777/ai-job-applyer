from __future__ import annotations

import io
import re
import sqlite3
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pypdf import PdfReader

DB_PATH = Path(__file__).resolve().parent / "assistant.db"

STOPWORDS = {
    "the", "and", "for", "that", "with", "you", "your", "are", "our",
    "will", "from", "this", "have", "job", "role", "team", "work",
    "experience", "skills", "they", "their", "not", "all",
}

PROFILE_SYNONYMS = {
    "full_name":          ["name", "full name", "legal name", "candidate name"],
    "email":              ["email", "e-mail", "email address"],
    "phone":              ["phone", "mobile", "telephone", "contact number"],
    "location":           ["location", "city", "address", "country"],
    "linkedin":           ["linkedin", "linkedin profile"],
    "github":             ["github", "portfolio", "website", "personal website"],
    "years_experience":   ["years of experience", "experience years", "yoe"],
    "current_title":      ["current title", "job title", "current role"],
    "current_company":    ["current company", "employer", "company"],
    "notice_period":      ["notice period", "availability", "start date"],
    "work_authorization": ["work authorization", "visa status", "authorized"],
    "salary_expectation": ["salary expectation", "salary", "compensation"],
}


# ── Pydantic models ────────────────────────────────────────────────────────────

class ProfilePayload(BaseModel):
    data: dict[str, str] = Field(default_factory=dict)


class JobScanPayload(BaseModel):
    page_text: str
    title: str | None = None
    company: str | None = None
    url: str | None = None


class FormField(BaseModel):
    name: str | None = None
    id: str | None = None
    label: str | None = None
    placeholder: str | None = None
    field_type: str | None = None


class FormSuggestPayload(BaseModel):
    fields: list[FormField]


class LearnPayload(BaseModel):
    field_label: str
    value: str


class CoverLetterPayload(BaseModel):
    tone: str = "professional"


@dataclass
class FieldSuggestion:
    key: str
    value: str | None


# ── Helpers ────────────────────────────────────────────────────────────────────

def utc_now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def normalize(text: str | None) -> str:
    if not text:
        return ""
    lowered = text.lower().strip()
    lowered = re.sub(r"[^a-z0-9\s]", " ", lowered)
    lowered = re.sub(r"\s+", " ", lowered)
    return lowered


# ── DB ─────────────────────────────────────────────────────────────────────────

def init_db() -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS profile (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT,
                company TEXT,
                url TEXT,
                description TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS field_memory (
                normalized_label TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        conn.commit()


def upsert_profile(data: dict[str, str]) -> None:
    if not data:
        return
    with sqlite3.connect(DB_PATH) as conn:
        for key, value in data.items():
            conn.execute("""
                INSERT INTO profile (key, value, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """, (key, value, utc_now()))
        conn.commit()


def get_profile() -> dict[str, str]:
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute("SELECT key, value FROM profile").fetchall()
    return {k: v for k, v in rows}


def store_job(payload: JobScanPayload) -> int:
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute("""
            INSERT INTO jobs (title, company, url, description, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, (payload.title, payload.company, payload.url, payload.page_text, utc_now()))
        conn.commit()
        return int(cursor.lastrowid)


def get_latest_job() -> dict[str, Any] | None:
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute("""
            SELECT id, title, company, url, description, created_at
            FROM jobs ORDER BY id DESC LIMIT 1
        """).fetchone()
    if not row:
        return None
    return {"id": row[0], "title": row[1], "company": row[2],
            "url": row[3], "description": row[4], "created_at": row[5]}


def remember_field(label: str, value: str) -> None:
    nlabel = normalize(label)
    if not nlabel:
        return
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            INSERT INTO field_memory (normalized_label, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(normalized_label) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """, (nlabel, value, utc_now()))
        conn.commit()


def get_field_memory() -> dict[str, str]:
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute("SELECT normalized_label, value FROM field_memory").fetchall()
    return {label: value for label, value in rows}


def extract_resume_text(raw_bytes: bytes, content_type: str | None) -> str:
    if content_type and "pdf" in content_type.lower():
        reader = PdfReader(io.BytesIO(raw_bytes))
        return "\n".join(page.extract_text() or "" for page in reader.pages).strip()
    decoded = raw_bytes.decode("utf-8", errors="ignore").strip()
    if not decoded:
        raise HTTPException(status_code=400, detail="Resume could not be decoded")
    return decoded


def top_keywords(text: str, limit: int = 15) -> list[str]:
    words = re.findall(r"[A-Za-z]{3,}", text.lower())
    filtered = [w for w in words if w not in STOPWORDS]
    return [w for w, _ in Counter(filtered).most_common(limit)]


def match_profile_value(
    field: FormField, profile: dict[str, str], memory: dict[str, str]
) -> FieldSuggestion:
    joined = normalize(" ".join(filter(None, [field.label, field.placeholder, field.name, field.id])))

    if joined in memory:
        return FieldSuggestion(key=joined, value=memory[joined])

    for known_key, aliases in PROFILE_SYNONYMS.items():
        if known_key not in profile:
            continue
        if any(alias in joined for alias in aliases):
            return FieldSuggestion(key=known_key, value=profile[known_key])

    for known_key, known_value in profile.items():
        if normalize(known_key) in joined:
            return FieldSuggestion(key=known_key, value=known_value)

    return FieldSuggestion(key=joined, value=None)


def generate_cover_letter_text(profile: dict[str, str], job: dict[str, Any], tone: str) -> str:
    full_name     = profile.get("full_name", "Candidate")
    current_title = profile.get("current_title", "professional")
    company       = job.get("company") or "your company"
    job_title     = job.get("title")   or "this role"
    resume_snippet = profile.get("resume_text", "")

    highlights   = ", ".join(top_keywords(resume_snippet, limit=8))
    jd_keywords  = ", ".join(top_keywords(job.get("description", ""), limit=10))

    tone_line = {"enthusiastic": "I am genuinely excited",
                 "concise": "I am writing"}.get(tone, "I am pleased")

    return (
        f"Dear Hiring Team,\n\n"
        f"{tone_line} to apply for the {job_title} position at {company}. "
        f"I am a {current_title} with hands-on experience in "
        f"{highlights or 'relevant technical and business work'}.\n\n"
        f"After reviewing your job description, I noticed strong alignment with my background, "
        f"especially around {jd_keywords or 'cross-functional execution and impact-oriented delivery'}. "
        f"I focus on building practical solutions, collaborating closely with stakeholders, "
        f"and shipping measurable outcomes.\n\n"
        f"I would value the opportunity to bring this mindset to {company}. "
        f"Thank you for your time and consideration.\n\n"
        f"Sincerely,\n{full_name}"
    )


# ── FastAPI app ────────────────────────────────────────────────────────────────

app = FastAPI(title="Job Application Assistant API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/profile")
def save_profile(payload: ProfilePayload) -> dict[str, Any]:
    upsert_profile(payload.data)
    return {"saved_keys": list(payload.data.keys())}


@app.get("/profile")
def read_profile() -> dict[str, Any]:
    profile = get_profile()
    return {
        "profile": {k: v for k, v in profile.items() if k != "resume_text"},
        "has_resume": bool(profile.get("resume_text", "").strip()),
    }


@app.post("/resume/upload")
def upload_resume(file: UploadFile = File(...)) -> dict[str, Any]:
    raw = file.file.read()
    text = extract_resume_text(raw, file.content_type)
    upsert_profile({"resume_text": text})
    return {"status": "resume_saved", "char_count": len(text)}


@app.post("/job/scan")
def scan_job(payload: JobScanPayload) -> dict[str, Any]:
    if len(payload.page_text.strip()) < 100:
        raise HTTPException(status_code=400, detail="Page text is too short to scan")
    job_id = store_job(payload)
    return {"job_id": job_id, "keywords": top_keywords(payload.page_text)}


@app.get("/job/latest")
def latest_job() -> dict[str, Any]:
    job = get_latest_job()
    if not job:
        raise HTTPException(status_code=404, detail="No scanned job found")
    return job


@app.post("/cover-letter/generate")
def generate_cover_letter(payload: CoverLetterPayload) -> dict[str, Any]:
    profile = get_profile()
    if not profile.get("resume_text"):
        raise HTTPException(status_code=400, detail="Upload your resume first")
    job = get_latest_job()
    if not job:
        raise HTTPException(status_code=400, detail="Scan a job description first")
    return {"cover_letter": generate_cover_letter_text(profile=profile, job=job, tone=payload.tone)}


@app.post("/form/suggest")
def suggest_for_form(payload: FormSuggestPayload) -> dict[str, Any]:
    profile = get_profile()
    memory  = get_field_memory()
    suggestions: dict[str, str] = {}
    unknown_fields: list[dict[str, str]] = []

    for field in payload.fields:
        key = field.name or field.id or field.label or "unknown"
        suggestion = match_profile_value(field=field, profile=profile, memory=memory)
        if suggestion.value:
            suggestions[key] = suggestion.value
        else:
            unknown_fields.append({
                "key": key,
                "label": field.label or field.placeholder or field.name or field.id or "Unknown field",
            })

    return {"suggestions": suggestions, "unknown_fields": unknown_fields}


@app.post("/form/learn")
def learn_field(payload: LearnPayload) -> dict[str, str]:
    remember_field(payload.field_label, payload.value)
    return {"status": "saved"}
