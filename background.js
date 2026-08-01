const resourcesByTab = new Map();

const IMAGE_EXTENSIONS = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const VIDEO_EXTENSIONS = /\.(?:mp4|m4v|mov|webm)$/i;
const STREAM_EXTENSIONS = /\.(?:m3u8|mpd)$/i;
const SEGMENT_EXTENSIONS = /\.(?:m4s|cmfv|cmfa|ts)$/i;

function headerValue(headers, name) {
  return headers?.find((header) => header.name.toLowerCase() === name)?.value || "";
}

function classify(details) {
  const pathname = new URL(details.url).pathname.toLowerCase();
  const contentType = headerValue(details.responseHeaders, "content-type").toLowerCase();

  if (STREAM_EXTENSIONS.test(pathname) || /(?:mpegurl|dash\+xml)/.test(contentType)) return "stream";
  if (SEGMENT_EXTENSIONS.test(pathname)) return "segment";
  if (details.type === "image" || IMAGE_EXTENSIONS.test(pathname) || contentType.startsWith("image/")) return "image";
  const contentLength = Number(headerValue(details.responseHeaders, "content-length")) || 0;
  if (VIDEO_EXTENSIONS.test(pathname) && contentLength > 0 && contentLength < 16 * 1024) return "segment";
  if (VIDEO_EXTENSIONS.test(pathname) && (contentType.startsWith("video/") || /video\.twimg\.com$/i.test(new URL(details.url).hostname))) return "video";
  return null;
}

function dimensionsFromUrl(rawUrl) {
  const match = new URL(rawUrl).pathname.match(/\/(\d{2,5})x(\d{2,5})\//);
  return match ? `${match[1]}×${match[2]}` : "";
}

function shouldCapture(details, kind) {
  if (details.tabId < 0 || !kind || kind === "segment") return false;
  return details.statusCode >= 200 && details.statusCode < 400 && /^https?:/i.test(details.url);
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const kind = classify(details);
    if (!shouldCapture(details, kind)) return;

    const urlObject = new URL(details.url);
    urlObject.hash = "";
    const url = urlObject.href;
    const tabResources = resourcesByTab.get(details.tabId) || new Map();
    const previous = tabResources.get(url);

    tabResources.set(url, {
      url,
      kind,
      mime: headerValue(details.responseHeaders, "content-type").split(";")[0],
      size: Number(headerValue(details.responseHeaders, "content-length")) || null,
      dimensions: kind === "video" ? dimensionsFromUrl(url) : "",
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

async function verifyStandaloneVideo(url) {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers: { Range: "bytes=0-4095" },
    credentials: "include",
    signal: controller.signal
  });
  if (!response.ok) throw new Error(`资源服务器返回 HTTP ${response.status}`);

  const contentRange = response.headers.get("content-range") || "";
  const rangeTotal = Number(contentRange.match(/\/(\d+)$/)?.[1]) || 0;
  const contentLength = Number(response.headers.get("content-length")) || 0;
  const totalSize = rangeTotal || contentLength;
  if (totalSize > 0 && totalSize < 64 * 1024) {
    controller.abort();
    throw new Error(`资源仅 ${totalSize} 字节，是初始化片段，不是完整视频`);
  }

  const reader = response.body.getReader();
  const { value } = await reader.read();
  controller.abort();
  const bytes = value || new Uint8Array();
  const ascii = String.fromCharCode(...bytes);
  const isMp4 = ascii.slice(4, 8) === "ftyp";
  const isWebM = bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (!isMp4 && !isWebM) throw new Error("该地址返回的是视频分片或网页，不是完整视频文件");
  if (isMp4 && ascii.includes("mvex") && !ascii.includes("mdat") && totalSize > 0 && totalSize < 256 * 1024) {
    throw new Error("检测到 fragmented MP4 初始化段，文件不含视频帧");
  }
}

function downloadFilename(url) {
  const pathName = decodeURIComponent(new URL(url).pathname);
  const baseName = pathName.split("/").pop() || `video-${Date.now()}.mp4`;
  return baseName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
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

  if (message.action === "download") {
    (async () => {
      if (message.kind === "video") await verifyStandaloneVideo(message.url);
      const downloadId = await chrome.downloads.download({
        url: message.url,
        filename: downloadFilename(message.url),
        saveAs: true
      });
      sendResponse({ ok: true, downloadId });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
