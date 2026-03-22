/**
 * Job Application Assistant — content script (Manifest V3)
 * Injected into every page. Builds a collapsible sidebar panel.
 */

(function () {
  "use strict";

  // ── Guard: only inject once ────────────────────────────────────────────────
  if (document.getElementById("ja-root")) return;

  // ── State ──────────────────────────────────────────────────────────────────
  const state = {
    get apiBase() {
      return localStorage.getItem("ja_apiBase") || "http://127.0.0.1:8765";
    },
    set apiBase(v) {
      localStorage.setItem("ja_apiBase", v.replace(/\/$/, ""));
    },
    unknownFields: [],
    lastFieldMap: {},
    open: false,
  };

  // ── DOM helpers ────────────────────────────────────────────────────────────
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "cls") node.className = v;
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const child of children) {
      if (child) node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  function inp(id, placeholder = "", type = "text") {
    const i = document.createElement("input");
    i.id = id;
    i.className = "ja-inp";
    i.type = type;
    i.placeholder = placeholder;
    return i;
  }

  function btn(id, text, colorCls) {
    const b = document.createElement("button");
    b.id = id;
    b.className = `ja-btn ${colorCls}`;
    b.textContent = text;
    return b;
  }

  function lbl(forId, text) {
    const l = document.createElement("label");
    l.className = "ja-lbl";
    l.setAttribute("for", forId);
    l.textContent = text;
    return l;
  }

  function section(title, ...children) {
    const s = document.createElement("div");
    s.className = "ja-section";
    const t = document.createElement("div");
    t.className = "ja-section-title";
    t.textContent = title;
    s.appendChild(t);
    for (const c of children) s.appendChild(c);
    return s;
  }

  // ── Build panel HTML ───────────────────────────────────────────────────────
  function buildPanel() {
    // Root wrapper (pointer-events:none shell)
    const root = document.createElement("div");
    root.id = "ja-root";

    // Toggle tab
    const toggle = document.createElement("div");
    toggle.id = "ja-toggle";
    toggle.textContent = "JOB ASSIST";

    // Main sliding panel
    const panel = document.createElement("div");
    panel.id = "ja-panel";

    // — Header —
    const head = document.createElement("div");
    head.className = "ja-head";
    const headTitle = document.createElement("div");
    headTitle.className = "ja-head-title";
    headTitle.textContent = "🧳 Job Assistant";
    const headClose = document.createElement("div");
    headClose.className = "ja-head-close";
    headClose.textContent = "×";
    headClose.title = "Close panel";
    head.appendChild(headTitle);
    head.appendChild(headClose);

    // — Body —
    const body = document.createElement("div");
    body.className = "ja-body";

    // § Config
    const apiInput = inp("ja-api-base", "http://127.0.0.1:8765");
    apiInput.value = state.apiBase;
    body.appendChild(section("⚙ Backend URL", lbl("ja-api-base", "API Base URL"), apiInput));

    // § Profile
    const profileTa = document.createElement("textarea");
    profileTa.id = "ja-profile-json";
    profileTa.className = "ja-inp";
    profileTa.placeholder = '{"full_name":"Jane Doe","email":"jane@example.com","phone":"..."}';
    body.appendChild(section(
      "👤 Profile",
      lbl("ja-profile-json", "Profile JSON"),
      profileTa,
      btn("ja-save-profile", "💾 Save Profile", "ja-btn-blue"),
    ));

    // § Resume
    const resumeFile = document.createElement("input");
    resumeFile.id = "ja-resume-file";
    resumeFile.type = "file";
    resumeFile.accept = ".pdf,.txt,text/plain,application/pdf";
    resumeFile.className = "ja-inp ja-file";
    body.appendChild(section(
      "📄 Resume",
      lbl("ja-resume-file", "Upload your resume (.pdf or .txt)"),
      resumeFile,
      btn("ja-upload-resume", "⬆ Upload Resume", "ja-btn-sky"),
    ));

    // § Actions
    const grid = document.createElement("div");
    grid.className = "ja-action-grid";
    const scanBtn  = btn("ja-scan",  "🔍 Scan Job",     "ja-btn-ghost");
    const fillBtn  = btn("ja-fill",  "✏ Autofill",      "ja-btn-green");
    const coverBtn = btn("ja-cover", "📝 Cover Letter",  "ja-btn-purple ja-btn-wide");
    grid.appendChild(scanBtn);
    grid.appendChild(fillBtn);
    grid.appendChild(coverBtn);
    body.appendChild(section("🚀 Actions", grid));

    // § Unknown fields (populated dynamically)
    const unknownSection = document.createElement("div");
    unknownSection.id = "ja-unknown-section";
    unknownSection.className = "ja-section";
    unknownSection.style.display = "none";
    const unknownTitle = document.createElement("div");
    unknownTitle.className = "ja-section-title";
    unknownTitle.textContent = "❓ Unknown fields";
    const unknownSubtitle = document.createElement("div");
    unknownSubtitle.style.cssText = "font-size:11px;color:#8b949e;";
    unknownSubtitle.textContent = "Teach once — remembered forever";
    const unknownList = document.createElement("div");
    unknownList.id = "ja-unknown-list";
    unknownList.className = "ja-unknown-list";
    unknownSection.appendChild(unknownTitle);
    unknownSection.appendChild(unknownSubtitle);
    unknownSection.appendChild(unknownList);
    body.appendChild(unknownSection);

    // — Status bar —
    const status = document.createElement("div");
    status.id = "ja-status";
    status.className = "ja-status";
    const dot = document.createElement("div");
    dot.id = "ja-status-dot";
    dot.className = "ja-status-dot";
    const statusText = document.createElement("span");
    statusText.id = "ja-status-text";
    statusText.textContent = "Ready";
    status.appendChild(dot);
    status.appendChild(statusText);

    // Assemble
    panel.appendChild(head);
    panel.appendChild(body);
    panel.appendChild(status);
    root.appendChild(toggle);
    root.appendChild(panel);
    document.body.appendChild(root);

    // ── Toggle open/close ────────────────────────────────────────────────────
    function togglePanel() {
      state.open = !state.open;
      if (state.open) {
        panel.classList.add("ja-open");
        toggle.style.right = "310px";
      } else {
        panel.classList.remove("ja-open");
        toggle.style.right = "0";
      }
    }
    toggle.addEventListener("click", togglePanel);
    headClose.addEventListener("click", togglePanel);

    // ── API URL change ───────────────────────────────────────────────────────
    apiInput.addEventListener("change", () => {
      state.apiBase = apiInput.value.trim();
      setStatus(`API set to ${state.apiBase}`, "info");
    });

    // ── Wire buttons ─────────────────────────────────────────────────────────
    document.getElementById("ja-save-profile").addEventListener("click", saveProfile);
    document.getElementById("ja-upload-resume").addEventListener("click", uploadResume);
    document.getElementById("ja-scan").addEventListener("click", scanJob);
    document.getElementById("ja-fill").addEventListener("click", autofill);
    document.getElementById("ja-cover").addEventListener("click", coverLetter);
  }

  // ── Status helper ──────────────────────────────────────────────────────────
  function setStatus(msg, type = "info") {
    const dot  = document.getElementById("ja-status-dot");
    const text = document.getElementById("ja-status-text");
    const bar  = document.getElementById("ja-status");
    if (!bar) return;
    bar.className = "ja-status ja-" + type;
    if (dot) dot.className = "ja-status-dot";
    if (text) text.textContent = msg;
  }

  // ── API wrappers ───────────────────────────────────────────────────────────
  async function apiPost(path, payload) {
    const res = await fetch(`${state.apiBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(body || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async function apiPostForm(path, formData) {
    const res = await fetch(`${state.apiBase}${path}`, { method: "POST", body: formData });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(body || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // ── Save profile ───────────────────────────────────────────────────────────
  async function saveProfile() {
    try {
      const raw = document.getElementById("ja-profile-json")?.value.trim();
      if (!raw) { setStatus("Paste your profile JSON first.", "err"); return; }
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Must be a JSON object");
      const result = await apiPost("/profile", { data: parsed });
      setStatus(`✔ Saved ${(result.saved_keys || []).length} profile keys`, "ok");
    } catch (e) {
      setStatus("Profile error: " + e.message, "err");
    }
  }

  // ── Upload resume ──────────────────────────────────────────────────────────
  async function uploadResume() {
    try {
      const fileInput = document.getElementById("ja-resume-file");
      const file = fileInput?.files?.[0];
      if (!file) { setStatus("Pick a resume file first.", "err"); return; }
      setStatus("Uploading resume…", "info");
      const fd = new FormData();
      fd.append("file", file);
      const result = await apiPostForm("/resume/upload", fd);
      setStatus(`✔ Resume saved (${result.char_count || 0} chars)`, "ok");
    } catch (e) {
      setStatus("Upload error: " + e.message, "err");
    }
  }

  // ── Scan job page ──────────────────────────────────────────────────────────
  async function scanJob() {
    try {
      setStatus("Scanning page…", "info");
      const result = await apiPost("/job/scan", {
        page_text: (document.body?.innerText || "").slice(0, 30000),
        title: document.title,
        url: window.location.href,
      });
      setStatus(`✔ Scanned — top: ${result.keywords.slice(0, 4).join(", ")}`, "ok");
    } catch (e) {
      setStatus("Scan error: " + e.message, "err");
    }
  }

  // ── Form helpers ───────────────────────────────────────────────────────────
  function getLabel(el) {
    const id = el.getAttribute("id");
    if (id) {
      const linked = document.querySelector(`label[for='${CSS.escape(id)}']`);
      if (linked?.innerText?.trim()) return linked.innerText.trim();
    }
    const parent = el.closest("label");
    if (parent?.innerText?.trim()) return parent.innerText.trim();
    return el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || id || "Unknown";
  }

  function collectFields() {
    return Array.from(document.querySelectorAll("input, textarea, select"))
      .filter((e) => {
        const t = (e.getAttribute("type") || "").toLowerCase();
        if (["hidden", "submit", "button", "file", "image", "reset"].includes(t)) return false;
        if (e.disabled || e.readOnly) return false;
        // exclude our own panel inputs
        if (e.closest("#ja-root")) return false;
        return true;
      })
      .map((e) => {
        const key = e.getAttribute("name") || e.getAttribute("id") || Math.random().toString(36).slice(2);
        return {
          key,
          element: e,
          payload: {
            name: e.getAttribute("name") || undefined,
            id: e.getAttribute("id") || undefined,
            label: getLabel(e),
            placeholder: e.getAttribute("placeholder") || undefined,
            field_type: e.tagName.toLowerCase() === "select"
              ? "select"
              : (e.getAttribute("type") || e.tagName.toLowerCase()),
          },
        };
      });
  }

  function applyValue(el, value) {
    if (el.tagName.toLowerCase() === "select") {
      el.value = value;
    } else if ((el.getAttribute("type") || "").toLowerCase() === "checkbox") {
      el.checked = ["yes", "true", "1", "on"].includes(String(value).toLowerCase());
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ── Autofill ───────────────────────────────────────────────────────────────
  async function autofill() {
    try {
      const fields = collectFields();
      if (!fields.length) { setStatus("No fillable fields found.", "err"); return; }
      setStatus(`Analyzing ${fields.length} fields…`, "info");
      const result = await apiPost("/form/suggest", { fields: fields.map((f) => f.payload) });
      const suggestions = result.suggestions || {};
      let count = 0;
      fields.forEach((f) => {
        const key = f.payload.name || f.payload.id || f.key;
        if (suggestions[key] !== undefined) {
          applyValue(f.element, suggestions[key]);
          count++;
        }
      });
      state.lastFieldMap = Object.fromEntries(fields.map((f) => [f.payload.name || f.payload.id || f.key, f]));
      state.unknownFields = result.unknown_fields || [];
      renderUnknown();
      setStatus(`✔ Filled ${count} of ${fields.length} fields`, "ok");
    } catch (e) {
      setStatus("Autofill error: " + e.message, "err");
    }
  }

  // ── Cover letter ───────────────────────────────────────────────────────────
  async function coverLetter() {
    try {
      setStatus("Generating cover letter…", "info");
      const result = await apiPost("/cover-letter/generate", { tone: "professional" });
      const letter = result.cover_letter || "";
      // Try to find a cover-letter textarea on the page
      const target = Array.from(document.querySelectorAll("textarea"))
        .filter((e) => !e.closest("#ja-root"))
        .find((e) => {
          const txt = `${getLabel(e)} ${e.getAttribute("name") || ""}`.toLowerCase();
          return txt.includes("cover") || txt.includes("motivation") || txt.includes("why");
        });
      if (target) {
        applyValue(target, letter);
        setStatus("✔ Cover letter inserted into form", "ok");
      } else {
        await navigator.clipboard.writeText(letter);
        setStatus("✔ Cover letter copied to clipboard", "ok");
      }
    } catch (e) {
      setStatus("Cover letter error: " + e.message, "err");
    }
  }

  // ── Render unknown fields ──────────────────────────────────────────────────
  function renderUnknown() {
    const sec  = document.getElementById("ja-unknown-section");
    const list = document.getElementById("ja-unknown-list");
    if (!sec || !list) return;
    list.innerHTML = "";
    if (!state.unknownFields.length) { sec.style.display = "none"; return; }
    sec.style.display = "";

    state.unknownFields.forEach((item) => {
      const row = document.createElement("div");
      row.className = "ja-unknown-row";

      const rowLabel = document.createElement("div");
      rowLabel.className = "ja-lbl";
      rowLabel.textContent = item.label;

      const rowInput = document.createElement("input");
      rowInput.className = "ja-inp";
      rowInput.placeholder = "Your answer…";
      rowInput.style.cssText = "margin-top:4px;";

      const rowBtn = document.createElement("button");
      rowBtn.className = "ja-btn ja-btn-green";
      rowBtn.style.marginTop = "5px";
      rowBtn.textContent = "💾 Save & Fill";
      rowBtn.addEventListener("click", async () => {
        const value = rowInput.value.trim();
        if (!value) return;
        try {
          await apiPost("/form/learn", { field_label: item.label, value });
          const mapped = state.lastFieldMap[item.key];
          if (mapped) applyValue(mapped.element, value);
          row.style.opacity = "0.45";
          setStatus(`✔ Learned: ${item.label}`, "ok");
        } catch (e) {
          setStatus("Learn error: " + e.message, "err");
        }
      });

      row.appendChild(rowLabel);
      row.appendChild(rowInput);
      row.appendChild(rowBtn);
      list.appendChild(row);
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  buildPanel();
})();
