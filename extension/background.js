// background.js — service worker
// Relays messages from the popup to the active tab's content script

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
