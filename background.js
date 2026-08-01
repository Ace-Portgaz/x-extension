const resourcesByTab = new Map();

function headerValue(headers, name) {
  return headers?.find((header) => header.name.toLowerCase() === name)?.value || "";
}

function isStream(details) {
  const pathname = new URL(details.url).pathname.toLowerCase();
  const contentType = headerValue(details.responseHeaders, "content-type").toLowerCase();
  return /\.(?:m3u8|mpd)$/.test(pathname) || /(?:mpegurl|dash\+xml)/.test(contentType);
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0 || details.statusCode < 200 || details.statusCode >= 400 || !isStream(details)) return;
    const urlObject = new URL(details.url);
    urlObject.hash = "";
    const url = urlObject.href;
    const tabResources = resourcesByTab.get(details.tabId) || new Map();
    const previous = tabResources.get(url);
    const responseType = headerValue(details.responseHeaders, "content-type").toLowerCase();
    const kind = urlObject.pathname.toLowerCase().endsWith(".mpd") || responseType.includes("dash+xml") ? "dash" : "hls";

    tabResources.set(url, {
      url,
      kind,
      mime: headerValue(details.responseHeaders, "content-type").split(";")[0],
      seenAt: Date.now(),
      count: (previous?.count || 0) + 1
    });
    resourcesByTab.set(details.tabId, tabResources);
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.tabs.onRemoved.addListener((tabId) => resourcesByTab.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") resourcesByTab.delete(tabId);
});

async function ensureOffscreenDocument() {
  const path = "offscreen.html";
  const offscreenUrl = chrome.runtime.getURL(path);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl]
  });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: path,
    reasons: ["BLOBS"],
    justification: "Assemble user-requested public HLS segments into a downloadable media file."
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "list") {
    const items = [...(resourcesByTab.get(message.tabId)?.values() || [])]
      .sort((a, b) => b.seenAt - a.seenAt);
    sendResponse({ items });
    return;
  }

  if (message.action === "clear") {
    resourcesByTab.delete(message.tabId);
    sendResponse({ ok: true });
    return;
  }

  if (message.action === "downloadStream") {
    (async () => {
      if (message.kind !== "hls") throw new Error("当前仅支持下载无加密 HLS；DASH 暂只支持复制链接");
      await ensureOffscreenDocument();
      const result = await chrome.runtime.sendMessage({
        target: "offscreen",
        action: "assembleHls",
        url: message.url
      });
      if (!result?.ok) throw new Error(result?.error || "流媒体下载失败");
      sendResponse(result);
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
