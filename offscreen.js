function absoluteUrl(value, base) {
  return new URL(value, base).href;
}

async function loadText(url) {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`读取播放列表失败：HTTP ${response.status}`);
  return response.text();
}

function selectHighestVariant(text, masterUrl) {
  const lines = text.split(/\r?\n/);
  const variants = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith("#EXT-X-STREAM-INF:")) continue;
    const bandwidth = Number(lines[index].match(/BANDWIDTH=(\d+)/)?.[1]) || 0;
    const resolution = lines[index].match(/RESOLUTION=(\d+x\d+)/)?.[1] || "";
    const uri = lines.slice(index + 1).find((line) => line && !line.startsWith("#"));
    if (uri) variants.push({ bandwidth, resolution, url: absoluteUrl(uri, masterUrl) });
  }
  return variants.sort((a, b) => b.bandwidth - a.bandwidth)[0] || null;
}

function parseMediaPlaylist(text, playlistUrl) {
  if (/#EXT-X-KEY:METHOD=(?!NONE)/.test(text)) throw new Error("检测到加密 HLS，扩展不会解密或绕过保护");
  if (text.includes("#EXT-X-BYTERANGE")) throw new Error("暂不支持字节范围型 HLS");
  if (!text.includes("#EXT-X-ENDLIST")) throw new Error("这是仍在更新的直播流，暂不支持下载");

  const urls = [];
  const mapMatch = text.match(/#EXT-X-MAP:[^\n]*URI="([^"]+)"/);
  if (mapMatch) urls.push(absoluteUrl(mapMatch[1], playlistUrl));
  for (const line of text.split(/\r?\n/)) {
    const value = line.trim();
    if (value && !value.startsWith("#")) urls.push(absoluteUrl(value, playlistUrl));
  }
  return urls;
}

async function assembleHls(masterUrl) {
  let playlistUrl = masterUrl;
  let text = await loadText(playlistUrl);
  const variant = selectHighestVariant(text, playlistUrl);
  if (variant) {
    playlistUrl = variant.url;
    text = await loadText(playlistUrl);
  }

  const segmentUrls = parseMediaPlaylist(text, playlistUrl);
  if (!segmentUrls.length) throw new Error("播放列表中没有可下载的媒体分片");

  const parts = [];
  let totalBytes = 0;
  for (let index = 0; index < segmentUrls.length; index += 1) {
    const response = await fetch(segmentUrls[index], { credentials: "include" });
    if (!response.ok) throw new Error(`第 ${index + 1} 个分片下载失败：HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    totalBytes += buffer.byteLength;
    if (totalBytes > 1024 * 1024 * 1024) throw new Error("媒体超过 1 GB，浏览器内存合并已停止");
    parts.push(buffer);
  }

  const firstPath = new URL(segmentUrls[0]).pathname.toLowerCase();
  const isTransportStream = firstPath.endsWith(".ts");
  const extension = isTransportStream ? "ts" : "mp4";
  const mime = isTransportStream ? "video/mp2t" : "video/mp4";
  const blobUrl = URL.createObjectURL(new Blob(parts, { type: mime }));
  try {
    const downloadId = await chrome.downloads.download({
      url: blobUrl,
      filename: `stream-${Date.now()}.${extension}`,
      saveAs: true
    });
    return { ok: true, downloadId, variant: variant?.resolution || "" };
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen" || message.action !== "assembleHls") return;
  assembleHls(message.url)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
