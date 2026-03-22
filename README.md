# 🧳 Job Application Assistant

A Chrome extension + Python backend that:
- **Scans** any job description page with one click
- **Autofills** application forms using your profile + resume
- **Generates** a tailored cover letter
- **Learns** unknown fields and fills them automatically next time

---

## Folder structure

```
job-assistant/
├── extension/          ← Load this folder in Chrome
│   ├── manifest.json
│   ├── content.js
│   ├── panel.css
│   └── icons/
└── backend/            ← Python API
    ├── app.py
    ├── main.py
    ├── requirements.txt
    └── render.yaml     ← free cloud deploy (optional)
```

---

## 1 — Backend setup (local)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python main.py
# → running on http://127.0.0.1:8765
```

---

## 2 — Chrome Extension setup

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. The extension is now active on every page

> **No Tampermonkey / Violentmonkey needed.**  
> Manifest V3 content scripts inject directly — no extra permissions dialog.

---

## 3 — First use

1. Open any job description page
2. A **"JOB ASSIST"** tab appears on the right edge — click it
3. **Settings**: confirm the API URL (`http://127.0.0.1:8765` by default)
4. **Profile**: paste a JSON object with your info, click *Save Profile*

```json
{
  "full_name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "+1 555 000 0000",
  "location": "Berlin, Germany",
  "linkedin": "https://linkedin.com/in/janedoe",
  "github": "https://github.com/janedoe",
  "current_title": "Software Engineer",
  "current_company": "Acme Corp",
  "years_experience": "5",
  "notice_period": "1 month",
  "work_authorization": "EU Citizen",
  "salary_expectation": "80000 EUR"
}
```

5. **Resume**: upload your `.pdf` or `.txt` resume
6. On a job page → click **🔍 Scan Job**
7. On the application form page → click **✏ Autofill**
8. Click **📝 Cover Letter** — it auto-inserts into the cover letter field, or copies to clipboard
9. Any field the bot didn't know appears under **❓ Unknown fields** — fill it once and it's remembered forever

---

## 4 — Free cloud deployment (optional)

Instead of running the backend locally, deploy it to **Render** for free so it works from any device.

1. Push the `backend/` folder to a GitHub repo
2. Go to [render.com](https://render.com) → New → Web Service → connect your repo
3. Render auto-detects `render.yaml` — just click **Deploy**
4. Copy your Render URL (e.g. `https://job-assistant-api.onrender.com`)
5. In the extension panel, change the **API Base URL** to your Render URL

> ⚠ Free Render services spin down after 15 min of inactivity.  
> The first request after idle takes ~30 seconds to wake up — normal behaviour.

---

## API endpoints (quick reference)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Check backend is alive |
| POST | `/profile` | Save profile keys |
| GET | `/profile` | Read saved profile |
| POST | `/resume/upload` | Upload PDF/TXT resume |
| POST | `/job/scan` | Scan a job description page |
| GET | `/job/latest` | Get last scanned job |
| POST | `/form/suggest` | Get field suggestions |
| POST | `/form/learn` | Save a new field answer |
| POST | `/cover-letter/generate` | Generate cover letter |
