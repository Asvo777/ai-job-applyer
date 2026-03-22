// ==UserScript==
// @name         Job Application Assistant Overlay
// @namespace    https://local.job.assistant
// @version      0.1.0
// @description  Scan job descriptions, autofill forms, generate cover letters, and learn unknown fields.
// @match        *://*/*
// @grant        none
// @connect      127.0.0.1
// ==/UserScript==

(function () {
  "use strict";

  const state = {
    apiBase: localStorage.getItem("jobAssistantApiBase") || "http://127.0.0.1:8765",
    unknownFields: [],
    lastFieldMap: {},
  };

  function createPanel() {
    const panel = document.createElement("div");
    panel.id = "job-assistant-overlay";
    panel.innerHTML = `
      <div class="ja-header">Job Assistant</div>
      <label class="ja-label">API URL</label>
      <input id="ja-api-base" class="ja-input" value="${state.apiBase}" />
      <label class="ja-label">Profile JSON (optional)</label>
      <textarea id="ja-profile-json" class="ja-input ja-textarea" placeholder='{"full_name":"Jane Doe","email":"jane@example.com"}'></textarea>
      <button id="ja-save-profile">Save Profile</button>
      <label class="ja-label">Resume file (.pdf or .txt)</label>
      <input id="ja-resume-file" class="ja-file" type="file" accept=".pdf,.txt,text/plain,application/pdf" />
      <button id="ja-upload-resume">Upload Resume</button>
      <div class="ja-actions">
        <button id="ja-scan">Scan Job</button>
        <button id="ja-fill">Autofill</button>
        <button id="ja-cover">Cover Letter</button>
      </div>
      <div id="ja-status" class="ja-status">Ready</div>
      <div id="ja-unknown" class="ja-unknown"></div>
    `;

    const style = document.createElement("style");
    style.textContent = `
      #job-assistant-overlay {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 300px;
        z-index: 999999;
        font-family: Segoe UI, sans-serif;
        background: #111827;
        color: #f9fafb;
        border-radius: 12px;
        border: 1px solid #374151;
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
        padding: 12px;
      }
      #job-assistant-overlay .ja-header {
        font-size: 15px;
        font-weight: 700;
        margin-bottom: 10px;
      }
      #job-assistant-overlay .ja-label {
        font-size: 12px;
        color: #9ca3af;
      }
      #job-assistant-overlay .ja-input {
        width: 100%;
        margin-top: 4px;
        margin-bottom: 8px;
        background: #1f2937;
        color: #f9fafb;
        border: 1px solid #4b5563;
        border-radius: 8px;
        padding: 7px;
      }
      #job-assistant-overlay .ja-textarea {
        min-height: 74px;
        resize: vertical;
      }
      #job-assistant-overlay .ja-file {
        width: 100%;
        margin-top: 4px;
        margin-bottom: 8px;
        font-size: 12px;
      }
      #job-assistant-overlay .ja-actions {
        display: grid;
        grid-template-columns: 1fr;
        gap: 6px;
      }
      #job-assistant-overlay button {
        background: #0ea5e9;
        border: 0;
        border-radius: 8px;
        color: #00111f;
        font-weight: 700;
        padding: 8px;
        cursor: pointer;
      }
      #job-assistant-overlay .ja-status {
        margin-top: 10px;
        font-size: 12px;
        color: #d1d5db;
      }
      #job-assistant-overlay .ja-unknown {
        margin-top: 10px;
        max-height: 280px;
        overflow-y: auto;
      }
      #job-assistant-overlay .ja-unknown-row {
        border-top: 1px solid #374151;
        padding-top: 8px;
        margin-top: 8px;
      }
      #job-assistant-overlay .ja-unknown-row label {
        display: block;
        font-size: 12px;
        margin-bottom: 4px;
      }
      #job-assistant-overlay .ja-unknown-row input {
        width: 100%;
        padding: 6px;
        border-radius: 6px;
        border: 1px solid #4b5563;
        background: #1f2937;
        color: #f9fafb;
      }
      #job-assistant-overlay .ja-unknown-row button {
        margin-top: 6px;
        background: #22c55e;
        color: #052e16;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(panel);

    document.getElementById("ja-api-base").addEventListener("change", (event) => {
      state.apiBase = event.target.value.trim().replace(/\/$/, "");
      localStorage.setItem("jobAssistantApiBase", state.apiBase);
      setStatus(`API set to ${state.apiBase}`);
    });

    document.getElementById("ja-scan").addEventListener("click", scanJobPage);
    document.getElementById("ja-fill").addEventListener("click", autofillForm);
    document.getElementById("ja-cover").addEventListener("click", generateCoverLetter);
    document.getElementById("ja-save-profile").addEventListener("click", saveProfileJson);
    document.getElementById("ja-upload-resume").addEventListener("click", uploadResume);
  }

  function setStatus(message) {
    const status = document.getElementById("ja-status");
    if (status) {
      status.textContent = message;
    }
  }

  async function apiPost(path, payload) {
    const response = await fetch(`${state.apiBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Request failed: ${response.status}`);
    }
    return response.json();
  }

  async function apiPostForm(path, formData) {
    const response = await fetch(`${state.apiBase}${path}`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Request failed: ${response.status}`);
    }
    return response.json();
  }

  async function saveProfileJson() {
    try {
      const text = document.getElementById("ja-profile-json").value.trim();
      if (!text) {
        setStatus("Paste profile JSON before saving.");
        return;
      }

      const parsed = JSON.parse(text);
      if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
        setStatus("Profile JSON must be an object.");
        return;
      }

      const result = await apiPost("/profile", { data: parsed });
      setStatus(`Saved profile keys: ${(result.saved_keys || []).length}`);
    } catch (error) {
      setStatus(`Profile save error: ${error.message}`);
    }
  }

  async function uploadResume() {
    try {
      const input = document.getElementById("ja-resume-file");
      const file = input?.files?.[0];
      if (!file) {
        setStatus("Choose a resume file before uploading.");
        return;
      }

      const formData = new FormData();
      formData.append("file", file);
      const result = await apiPostForm("/resume/upload", formData);
      setStatus(`Resume uploaded (${result.char_count || 0} chars).`);
    } catch (error) {
      setStatus(`Resume upload error: ${error.message}`);
    }
  }

  function getPageText() {
    return (document.body?.innerText || "").slice(0, 30000);
  }

  async function scanJobPage() {
    try {
      setStatus("Scanning page...");
      const payload = {
        page_text: getPageText(),
        title: document.title,
        url: window.location.href,
      };
      const result = await apiPost("/job/scan", payload);
      setStatus(`Scanned. Top keywords: ${result.keywords.slice(0, 5).join(", ")}`);
    } catch (error) {
      setStatus(`Scan error: ${error.message}`);
    }
  }

  function getFieldLabel(element) {
    const id = element.getAttribute("id");
    if (id) {
      const linked = document.querySelector(`label[for='${id}']`);
      if (linked && linked.innerText.trim()) {
        return linked.innerText.trim();
      }
    }

    const parentLabel = element.closest("label");
    if (parentLabel && parentLabel.innerText.trim()) {
      return parentLabel.innerText.trim();
    }

    const aria = element.getAttribute("aria-label");
    if (aria) {
      return aria.trim();
    }

    return element.getAttribute("placeholder") || element.getAttribute("name") || id || "Unknown";
  }

  function collectFormFields() {
    const elements = Array.from(document.querySelectorAll("input, textarea, select"));
    return elements
      .filter((element) => {
        const type = (element.getAttribute("type") || "").toLowerCase();
        if (["hidden", "submit", "button", "file", "image", "reset"].includes(type)) {
          return false;
        }
        if (element.disabled || element.readOnly) {
          return false;
        }
        return true;
      })
      .map((element) => {
        const key = element.getAttribute("name") || element.getAttribute("id") || Math.random().toString(36).slice(2);
        return {
          key,
          element,
          payload: {
            name: element.getAttribute("name") || undefined,
            id: element.getAttribute("id") || undefined,
            label: getFieldLabel(element),
            placeholder: element.getAttribute("placeholder") || undefined,
            field_type: element.tagName.toLowerCase() === "select" ? "select" : element.getAttribute("type") || element.tagName.toLowerCase(),
          },
        };
      });
  }

  function applyValue(element, value) {
    if (element.tagName.toLowerCase() === "select") {
      element.value = value;
    } else if ((element.getAttribute("type") || "").toLowerCase() === "checkbox") {
      const truthy = ["yes", "true", "1", "on"].includes(String(value).toLowerCase());
      element.checked = truthy;
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function autofillForm() {
    try {
      const fields = collectFormFields();
      if (!fields.length) {
        setStatus("No fillable fields found on this page.");
        return;
      }

      setStatus(`Analyzing ${fields.length} fields...`);
      const result = await apiPost("/form/suggest", {
        fields: fields.map((f) => f.payload),
      });

      const suggestions = result.suggestions || {};
      let filledCount = 0;

      fields.forEach((field) => {
        const idKey = field.payload.name || field.payload.id || field.key;
        const suggestion = suggestions[idKey];
        if (suggestion !== undefined) {
          applyValue(field.element, suggestion);
          filledCount += 1;
        }
      });

      state.lastFieldMap = Object.fromEntries(fields.map((f) => [f.payload.name || f.payload.id || f.key, f]));
      state.unknownFields = result.unknown_fields || [];
      renderUnknownFields();
      setStatus(`Autofill complete. Filled ${filledCount} fields.`);
    } catch (error) {
      setStatus(`Autofill error: ${error.message}`);
    }
  }

  function findCoverLetterTextArea() {
    const elements = Array.from(document.querySelectorAll("textarea"));
    return elements.find((el) => {
      const text = `${getFieldLabel(el)} ${(el.getAttribute("name") || "")}`.toLowerCase();
      return text.includes("cover") || text.includes("motivation") || text.includes("why");
    });
  }

  async function generateCoverLetter() {
    try {
      setStatus("Generating cover letter...");
      const result = await apiPost("/cover-letter/generate", { tone: "professional" });
      const letter = result.cover_letter || "";
      const textarea = findCoverLetterTextArea();

      if (textarea) {
        applyValue(textarea, letter);
        setStatus("Cover letter generated and inserted.");
      } else {
        await navigator.clipboard.writeText(letter);
        setStatus("Cover letter copied to clipboard.");
      }
    } catch (error) {
      setStatus(`Cover letter error: ${error.message}`);
    }
  }

  function renderUnknownFields() {
    const root = document.getElementById("ja-unknown");
    if (!root) {
      return;
    }

    root.innerHTML = "";

    if (!state.unknownFields.length) {
      return;
    }

    const title = document.createElement("div");
    title.style.fontSize = "12px";
    title.style.color = "#9ca3af";
    title.textContent = "Unknown fields (teach once, reuse later):";
    root.appendChild(title);

    state.unknownFields.forEach((item) => {
      const row = document.createElement("div");
      row.className = "ja-unknown-row";

      const label = document.createElement("label");
      label.textContent = item.label;

      const input = document.createElement("input");
      input.placeholder = "Type value to remember";

      const button = document.createElement("button");
      button.textContent = "Save + Fill";
      button.addEventListener("click", async () => {
        const value = input.value.trim();
        if (!value) {
          return;
        }

        try {
          await apiPost("/form/learn", {
            field_label: item.label,
            value,
          });

          const mapped = state.lastFieldMap[item.key];
          if (mapped) {
            applyValue(mapped.element, value);
          }
          setStatus(`Learned: ${item.label}`);
        } catch (error) {
          setStatus(`Learn error: ${error.message}`);
        }
      });

      row.appendChild(label);
      row.appendChild(input);
      row.appendChild(button);
      root.appendChild(row);
    });
  }

  createPanel();
})();
