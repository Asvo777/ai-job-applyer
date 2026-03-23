// popup.js

// ── Storage helpers ────────────────────────────────────────────────────────────
const PROFILE_KEYS = [
  "full_name","email","phone","location","current_title","current_company",
  "years_experience","notice_period","linkedin","github","work_authorization","salary_expectation","projects"
];

function save(obj) {
  return new Promise(r => chrome.storage.local.set(obj, r));
}
function load(keys) {
  return new Promise(r => chrome.storage.local.get(keys, r));
}

// ── Toast ──────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = "") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "show " + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ""; }, 3000);
}

// ── Tabs ───────────────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
  });
});

// ── API helpers ────────────────────────────────────────────────────────────────
async function getSettings() {
  const s = await load(["apiBase", "geminiKey"]);
  return {
    apiBase: s.apiBase || "http://127.0.0.1:8765",
    geminiKey: s.geminiKey || "",
  };
}

async function apiPost(path, body) {
  const { apiBase } = await getSettings();
  const res = await fetch(apiBase + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return res.json();
}

async function apiGet(path) {
  const { apiBase } = await getSettings();
  const res = await fetch(apiBase + path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Backend health ─────────────────────────────────────────────────────────────
async function checkBackend() {
  const dot  = document.getElementById("api-dot");
  const text = document.getElementById("api-status-text");
  dot.className = "status-dot loading";
  text.textContent = "Checking backend…";
  try {
    await apiGet("/health");
    dot.className = "status-dot";
    text.textContent = "Backend connected ✔";
    return true;
  } catch {
    dot.className = "status-dot offline";
    text.textContent = "Backend offline — run python main.py";
    return false;
  }
}

// ── Settings tab ───────────────────────────────────────────────────────────────
async function loadSettings() {
  const s = await getSettings();
  document.getElementById("s-api-base").value = s.apiBase;
  document.getElementById("s-api-key").value  = s.anthropicKey;
}

document.getElementById("btn-save-settings").addEventListener("click", async () => {
  const apiBase    = document.getElementById("s-api-base").value.trim().replace(/\/$/, "");
  const geminiKey  = document.getElementById("s-api-key").value.trim();
  await save({ apiBase, geminiKey });
  toast("Settings saved ✔", "ok");
  checkBackend();
});

document.getElementById("btn-check-backend").addEventListener("click", async () => {
  const ok = await checkBackend();
  toast(ok ? "Backend is online ✔" : "Cannot reach backend ✖", ok ? "ok" : "err");
});

// ── Profile tab ────────────────────────────────────────────────────────────────
async function loadProfile() {
  const stored = await load(PROFILE_KEYS);
  PROFILE_KEYS.forEach(k => {
    const el = document.getElementById("p-" + k);
    if (el) el.value = stored[k] || "";
  });
}

document.getElementById("btn-save-profile").addEventListener("click", async () => {
  const data = {};
  PROFILE_KEYS.forEach(k => {
    const el = document.getElementById("p-" + k);
    if (el?.value.trim()) data[k] = el.value.trim();
  });
  // Save locally
  await save(data);
  // Also push to backend
  try {
    await apiPost("/profile", { data });
    toast("Profile saved ✔", "ok");
  } catch {
    toast("Saved locally (backend offline)", "");
  }
});

// ── Resume tab ─────────────────────────────────────────────────────────────────
async function loadResumeStatus() {
  const box = document.getElementById("resume-status");
  try {
    const r = await apiGet("/profile");
    if (r.has_resume) {
      box.style.display = "";
      box.className = "info-box ok";
      box.textContent = "✔ Resume is uploaded and ready.";
    } else {
      box.style.display = "";
      box.className = "info-box warn";
      box.textContent = "⚠ No resume uploaded yet.";
    }
  } catch {
    box.style.display = "";
    box.className = "info-box";
    box.textContent = "Backend offline — resume status unknown.";
  }
}

document.getElementById("btn-upload-resume").addEventListener("click", async () => {
  const file = document.getElementById("resume-file").files?.[0];
  if (!file) { toast("Pick a file first", "err"); return; }
  toast("Uploading…", "");
  try {
    const fd = new FormData();
    fd.append("file", file);
    const { apiBase } = await getSettings();
    const res = await fetch(apiBase + "/resume/upload", { method: "POST", body: fd });
    if (!res.ok) throw new Error(await res.text());
    const r = await res.json();
    toast(`Resume uploaded (${r.char_count} chars) ✔`, "ok");
    loadResumeStatus();
  } catch (e) {
    toast("Upload failed: " + e.message, "err");
  }
});

document.getElementById("btn-save-text").addEventListener("click", async () => {
  const text = document.getElementById("resume-text").value.trim();
  if (!text) { toast("Paste resume text first", "err"); return; }
  try {
    await apiPost("/profile", { data: { resume_text: text } });
    toast("Resume text saved ✔", "ok");
    loadResumeStatus();
  } catch (e) {
    toast("Error: " + e.message, "err");
  }
});

// ── Actions tab ────────────────────────────────────────────────────────────────

// Helper: send a message to the content script in the active tab
function sendToContent(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ ...msg, target: "content" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

// Scan job
document.getElementById("btn-scan").addEventListener("click", async () => {
  toast("Scanning page…", "");
  try {
    const result = await sendToContent({ action: "scan" });
    toast("Scanned ✔  Top: " + (result.keywords || []).slice(0,3).join(", "), "ok");
    loadLastJob();
  } catch (e) {
    toast("Scan error: " + e.message, "err");
  }
});

// Autofill form
document.getElementById("btn-fill").addEventListener("click", async () => {
  toast("Autofilling…", "");
  try {
    const result = await sendToContent({ action: "autofill" });
    toast(`Filled ${result.filled} fields ✔`, "ok");
  } catch (e) {
    toast("Autofill error: " + e.message, "err");
  }
});

// Cover letter — calls Gemini API (free, no credit card needed)
document.getElementById("btn-cover").addEventListener("click", async () => {
  const { geminiKey } = await getSettings();
  if (!geminiKey) {
    toast("Add your Gemini API key in ⚙ Settings first", "err");
    return;
  }

  toast("AI is writing your cover letter…", "");

  try {
    // Get resume + profile from backend (with local storage fallback)
    const [profileData, jobData] = await Promise.all([
      apiGet("/profile").catch(() => null),
      apiGet("/job/latest").catch(() => null),
    ]);

    const stored = await load(PROFILE_KEYS);
    const profile = profileData?.profile || stored;

    const resumeInfo = profileData?.has_resume
      ? "The candidate has uploaded a resume stored on the backend."
      : "No resume on file — use general professional tone.";

    const jobInfo = jobData
      ? `Job title: ${jobData.title || "unknown"}\nCompany: ${jobData.company || "unknown"}\nDescription excerpt:\n${(jobData.description || "").slice(0, 3000)}`
      : "No job description scanned yet — write a general cover letter.";

    const profileStr = Object.entries(profile)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");

    const prompt = [
      "You are a professional career coach. Write a complete cover letter with exactly 4 paragraphs:",
      "",
      "1. INTRO: Strong opening hook naming the specific role and company, and why you are excited.",
      "2. SKILLS & EXPERIENCE: How your background and technical skills directly match the job requirements.",
      "3. PROJECTS: Highlight 1-2 specific projects from the profile most relevant to this role and their impact.",
      "4. OUTRO: Confident closing with eagerness to discuss further, signed with the candidate name.",
      "",
      "CANDIDATE PROFILE:",
      profileStr || "(no profile saved)",
      "",
      "RESUME STATUS: " + resumeInfo,
      "",
      "JOB INFORMATION:",
      jobInfo,
      "",
      "Rules:",
      "- Use the actual company name and job title everywhere, no placeholders like [Company]",
      "- Be specific: reference real skills, real projects, real technologies from the profile",
      "- Tone: professional but warm",
      "- Total length: 350-450 words",
      "- Return ONLY the cover letter text, no section headers, no commentary",
    ].join("\n");

    // Call Gemini API (free tier: no credit card, no expiry)
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Gemini API error ${res.status}`);
    }

    const data = await res.json();
    const letter = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!letter) throw new Error("Empty response from Gemini");

    // Try to inject into page cover letter field, else copy to clipboard
    try {
      await sendToContent({ action: "insertCoverLetter", text: letter });
      toast("Cover letter inserted into form ✔", "ok");
    } catch {
      await navigator.clipboard.writeText(letter);
      toast("Copied to clipboard ✔ (no cover letter field found)", "ok");
    }

  } catch (e) {
    toast("Cover letter error: " + e.message, "err");
  }
});

// Load last scanned job info
async function loadLastJob() {
  const box = document.getElementById("last-job-box");
  try {
    const job = await apiGet("/job/latest");
    box.style.display = "";
    box.className = "info-box ok";
    box.innerHTML = `<strong>Last scanned job:</strong> ${job.title || "Untitled"} ${job.company ? "@ " + job.company : ""}<br><span style="color:#6e7681;font-size:10px">${job.url || ""}</span>`;
  } catch {
    box.style.display = "none";
  }
}

// ── Init ───────────────────────────────────────────────────────────────────────
async function init() {
  await loadSettings();
  await loadProfile();
  checkBackend();
  loadLastJob();
  loadResumeStatus();
}

init();