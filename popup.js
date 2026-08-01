let activeTabId;
let allItems = [];
let currentKind = "all";
let previews = { exact: {}, videoPosters: [] };

const list = document.querySelector("#list");
const summary = document.querySelector("#summary");

function visibleItems() {
  return currentKind === "all" ? allItems : allItems.filter((item) => item.kind === currentKind);
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function addImagePreview(row, url, fallback) {
  const img = document.createElement("img");
  img.className = "thumb";
  img.src = url;
  img.alt = "";
  img.referrerPolicy = "no-referrer";
  img.onerror = () => img.replaceWith(fallback);
  row.append(img);
}

function addVideoPreview(row, url, fallback) {
  const video = document.createElement("video");
  video.className = "thumb";
  video.src = url;
  video.muted = true;
  video.preload = "metadata";
  video.playsInline = true;
  video.addEventListener("loadedmetadata", () => {
    if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(0.1, video.duration / 2);
  }, { once: true });
  video.addEventListener("error", () => video.replaceWith(fallback), { once: true });
  row.append(video);
}

function render() {
  list.replaceChildren();
  const items = visibleItems();
  summary.textContent = `已捕获 ${allItems.length} 个资源，显示 ${items.length} 个`;

  if (!items.length) {
    list.append(node("div", "empty", "还没有捕获到资源。\n打开或刷新目标网页并播放媒体，然后再点刷新。"));
    return;
  }

  let unmatchedVideoIndex = 0;
  for (const item of items) {
    const row = node("section", "item");
    const preview = node("div", "thumb", item.kind.toUpperCase());
    if (item.kind === "image") {
      addImagePreview(row, item.url, preview);
    } else if (item.kind === "video") {
      const poster = previews.exact[item.url] || previews.videoPosters[unmatchedVideoIndex++];
      if (poster) addImagePreview(row, poster, preview);
      else addVideoPreview(row, item.url, preview);
    } else {
      row.append(preview);
    }

    const meta = node("div", "meta");
    const url = node("div", "url", item.url);
    url.title = item.url;
    const actions = node("div", "actions");
    const detail = [item.kind, item.dimensions].filter(Boolean).join(" · ");
    actions.append(node("span", "badge", detail));

    const copy = node("button", "", "复制");
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(item.url);
      copy.textContent = "已复制";
      setTimeout(() => copy.textContent = "复制", 900);
    });
    actions.append(copy);

    if (item.kind !== "stream") {
      const download = node("button", "", "下载");
      download.addEventListener("click", async () => {
        download.disabled = true;
        download.textContent = "验证中";
        const result = await chrome.runtime.sendMessage({ action: "download", url: item.url, kind: item.kind });
        download.disabled = false;
        download.textContent = result.ok ? "已启动" : "无法下载";
        if (!result.ok) {
          download.title = result.error;
          summary.textContent = `下载失败：${result.error}`;
        }
      });
      actions.append(download);
    }

    meta.append(url, actions);
    row.append(meta);
    list.append(row);
  }
}

async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab.id;
  try {
    previews = await chrome.tabs.sendMessage(activeTabId, { action: "previews" });
  } catch {
    previews = { exact: {}, videoPosters: [] };
  }
  const result = await chrome.runtime.sendMessage({ action: "list", tabId: activeTabId });
  allItems = result.items || [];
  render();
}

document.querySelector("#filters").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-kind]");
  if (!button) return;
  currentKind = button.dataset.kind;
  document.querySelectorAll("#filters button").forEach((item) => item.classList.toggle("active", item === button));
  render();
});

document.querySelector("#refresh").addEventListener("click", refresh);
document.querySelector("#copy-all").addEventListener("click", async () => {
  await navigator.clipboard.writeText(visibleItems().map((item) => item.url).join("\n"));
});
document.querySelector("#clear").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ action: "clear", tabId: activeTabId });
  allItems = [];
  render();
});

refresh();
