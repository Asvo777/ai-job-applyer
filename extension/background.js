// background.js — service worker
// Relays messages from the popup to the active tab's content script

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === "backend") {
    chrome.storage.local.get(["apiBase"], async (settings) => {
      try {
        const apiBase = (settings.apiBase || "http://127.0.0.1:8765").replace(/\/$/, "");
        const path = message.path || "/";
        const method = (message.method || "GET").toUpperCase();

        const init = { method, headers: {} };
        if (message.body !== undefined) {
          init.headers["Content-Type"] = "application/json";
          init.body = JSON.stringify(message.body);
        }

        const res = await fetch(apiBase + path, init);
        const contentType = res.headers.get("content-type") || "";
        const payload = contentType.includes("application/json")
          ? await res.json().catch(() => null)
          : await res.text().catch(() => "");

        if (!res.ok) {
          const detail = typeof payload === "string" ? payload : payload?.detail || "Request failed";
          sendResponse({ error: detail || `HTTP ${res.status}`, status: res.status });
          return;
        }

        sendResponse({ ok: true, data: payload, status: res.status });
      } catch (error) {
        sendResponse({ error: error?.message || "Failed to fetch backend" });
      }
    });
    return true;
  }

  if (message.target === "content") {
    // Forward to the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        sendResponse({ error: "No active tab" });
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      });
    });
    return true; // keep channel open for async response
  }
});
