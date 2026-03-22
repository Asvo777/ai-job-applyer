// content.js — injected into every page
// Listens for messages from the popup and acts on the page DOM.

(function () {
  "use strict";

  // ── State ──────────────────────────────────────────────────────────────────
  const state = {
    lastFieldMap: {},
    unknownFields: [],
  };

  // ── API base from storage ──────────────────────────────────────────────────
  function getApiBase() {
    return new Promise(resolve => {
      chrome.storage.local.get(["apiBase"], r => {
        resolve((r.apiBase || "http://127.0.0.1:8765").replace(/\/$/, ""));
      });
    });
  }

  async function apiPost(path, body) {
    const base = await getApiBase();
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
    return res.json();
  }

  // ── Form utilities ─────────────────────────────────────────────────────────
  function getLabel(el) {
    const id = el.getAttribute("id");
    if (id) {
      try {
        const linked = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (linked?.innerText?.trim()) return linked.innerText.trim();
      } catch {}
    }
    const parent = el.closest("label");
    if (parent?.innerText?.trim()) return parent.innerText.trim();
    return (
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("name") ||
      id ||
      "Unknown"
    );
  }

  function collectFields() {
    const SKIP_TYPES = new Set(["hidden","submit","button","file","image","reset","search"]);
    return Array.from(document.querySelectorAll("input, textarea, select"))
      .filter(e => {
        const t = (e.getAttribute("type") || "").toLowerCase();
        if (SKIP_TYPES.has(t)) return false;
        if (e.disabled || e.readOnly) return false;
        return true;
      })
      .map(e => {
        const key = e.getAttribute("name") || e.getAttribute("id") || Math.random().toString(36).slice(2);
        return {
          key,
          element: e,
          payload: {
            name:       e.getAttribute("name")        || undefined,
            id:         e.getAttribute("id")          || undefined,
            label:      getLabel(e),
            placeholder:e.getAttribute("placeholder") || undefined,
            field_type: e.tagName.toLowerCase() === "select" ? "select" : (e.getAttribute("type") || e.tagName.toLowerCase()),
          },
        };
      });
  }

  function applyValue(el, value) {
    if (el.tagName.toLowerCase() === "select") {
      el.value = value;
    } else if ((el.getAttribute("type") || "").toLowerCase() === "checkbox") {
      el.checked = ["yes","true","1","on"].includes(String(value).toLowerCase());
    } else {
      el.value = value;
      // React / Vue friendly
      const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      const nativeTextareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      const setter = el.tagName === "TEXTAREA" ? nativeTextareaSetter : nativeInputSetter;
      if (setter) setter.call(el, value);
    }
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ── Find cover letter field ────────────────────────────────────────────────
  function findCoverLetterField() {
    return Array.from(document.querySelectorAll("textarea, div[contenteditable='true']"))
      .find(el => {
        const txt = `${getLabel(el)} ${el.getAttribute("name") || ""} ${el.getAttribute("placeholder") || ""}`.toLowerCase();
        return txt.includes("cover") || txt.includes("motivation") || txt.includes("letter") || txt.includes("why");
      });
  }

  // ── Message handler ────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.target !== "content") return;

    (async () => {
      try {
        switch (message.action) {

          // ── Scan job page ──────────────────────────────────────────────────
          case "scan": {
            const text = (document.body?.innerText || "").slice(0, 30000);
            if (text.trim().length < 100) {
              sendResponse({ error: "Page text too short — are you on a job description page?" });
              return;
            }
            const result = await apiPost("/job/scan", {
              page_text: text,
              title: document.title,
              url: window.location.href,
            });
            sendResponse({ keywords: result.keywords });
            break;
          }

          // ── Autofill form ──────────────────────────────────────────────────
          case "autofill": {
            const fields = collectFields();
            if (!fields.length) {
              sendResponse({ error: "No fillable fields found on this page." });
              return;
            }
            const result = await apiPost("/form/suggest", { fields: fields.map(f => f.payload) });
            const suggestions = result.suggestions || {};
            let filled = 0;
            fields.forEach(f => {
              const key = f.payload.name || f.payload.id || f.key;
              if (suggestions[key] !== undefined) {
                applyValue(f.element, suggestions[key]);
                filled++;
              }
            });
            state.lastFieldMap   = Object.fromEntries(fields.map(f => [f.payload.name || f.payload.id || f.key, f]));
            state.unknownFields  = result.unknown_fields || [];
            sendResponse({ filled, total: fields.length, unknown: state.unknownFields });
            break;
          }

          // ── Insert cover letter ────────────────────────────────────────────
          case "insertCoverLetter": {
            const target = findCoverLetterField();
            if (!target) {
              sendResponse({ error: "No cover letter field found" });
              return;
            }
            if (target.getAttribute("contenteditable")) {
              target.innerText = message.text;
              target.dispatchEvent(new Event("input", { bubbles: true }));
            } else {
              applyValue(target, message.text);
            }
            sendResponse({ ok: true });
            break;
          }

          // ── Learn unknown field ────────────────────────────────────────────
          case "learnField": {
            await apiPost("/form/learn", { field_label: message.label, value: message.value });
            const mapped = state.lastFieldMap[message.key];
            if (mapped) applyValue(mapped.element, message.value);
            sendResponse({ ok: true });
            break;
          }

          default:
            sendResponse({ error: "Unknown action: " + message.action });
        }
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();

    return true; // keep channel open for async
  });

})();
