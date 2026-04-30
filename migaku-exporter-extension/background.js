// Service worker for Migaku Exporter Chrome Extension
// Two responsibilities: fetch proxy + route change detection

// --- A. Fetch proxy ---
// Content scripts on study.migaku.com can't make cross-origin requests to
// securetoken.googleapis.com, api.openai.com, file-sync-worker-api.migaku.com,
// or raw.githubusercontent.com. The service worker proxies these requests.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "fetch") {
    handleFetchJson(message)
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, status: 0, data: null, error: err.message }));
    return true; // keep message channel open for async response
  }

  if (message.action === "fetchBlob") {
    handleFetchBlob(message)
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, status: 0, blobBase64: null, contentType: null, error: err.message }));
    return true;
  }
});

async function handleFetchJson({ url, options }) {
  const resp = await fetch(url, options || {});
  const data = await resp.json().catch(() => null);
  return { ok: resp.ok, status: resp.status, data };
}

async function handleFetchBlob({ url, options }) {
  const resp = await fetch(url, options || {});
  if (resp.status !== 200) {
    return { ok: false, status: resp.status, blobBase64: null, contentType: null };
  }
  const buffer = await resp.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  const contentType = resp.headers.get("content-type") || "application/octet-stream";
  return { ok: true, status: resp.status, blobBase64: base64, contentType };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// --- B. Route change detection ---
// Replaces monkey-patched history.pushState/replaceState from content script.
// Sends route change notifications so the content script can show/hide UI.

chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => {
    chrome.tabs.sendMessage(details.tabId, {
      action: "routeChanged",
      url: details.url
    }).catch(() => {
      // Tab may not have content script loaded yet, ignore
    });
  },
  { url: [{ hostEquals: "study.migaku.com" }] }
);
