let activeTabId;
let allItems = [];
let previews = { posters: [] };

const list = document.querySelector("#list");
const summary = document.querySelector("#summary");

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function addPreview(row, url, fallback) {
  if (!url) return row.append(fallback);
  const img = document.createElement("img");
  img.className = "thumb";
  img.src = url;
  img.alt = "视频缩略图";
  img.referrerPolicy = "no-referrer";
  img.onerror = () => img.replaceWith(fallback);
  row.append(img);
}

function render() {
  list.replaceChildren();
  summary.textContent = `已捕获 ${allItems.length} 个流媒体清单`;
  if (!allItems.length) {
    list.append(node("div", "empty", "尚未捕获流媒体。请刷新网页并播放目标视频，然后再次刷新列表。"));
    return;
  }

  allItems.forEach((item, index) => {
    const row = node("section", "item");
    addPreview(row, previews.posters[index] || previews.posters[0], node("div", "thumb", item.kind.toUpperCase()));
    const meta = node("div", "meta");
    const url = node("div", "url", item.url);
    url.title = item.url;
    const actions = node("div", "actions");
    actions.append(node("span", "badge", item.kind.toUpperCase()));

    const copy = node("button", "", "复制");
    copy.onclick = async () => {
      await navigator.clipboard.writeText(item.url);
      copy.textContent = "已复制";
    };
    actions.append(copy);

    const download = node("button", "", item.kind === "hls" ? "下载" : "仅复制");
    download.disabled = item.kind !== "hls";
    download.onclick = async () => {
      download.disabled = true;
      download.textContent = "处理中…";
      const result = await chrome.runtime.sendMessage({ action: "downloadStream", url: item.url, kind: item.kind });
      download.disabled = false;
      download.textContent = result.ok ? "已启动" : "失败";
      summary.textContent = result.ok ? `下载已启动${result.variant ? `（${result.variant}）` : ""}` : `下载失败：${result.error}`;
    };
    actions.append(download);
    meta.append(url, actions);
    row.append(meta);
    list.append(row);
  });
}

async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab.id;
  try { previews = await chrome.tabs.sendMessage(activeTabId, { action: "previews" }); }
  catch { previews = { posters: [] }; }
  const result = await chrome.runtime.sendMessage({ action: "list", tabId: activeTabId });
  allItems = result.items || [];
  render();
}

document.querySelector("#refresh").onclick = refresh;
document.querySelector("#copy-all").onclick = () => navigator.clipboard.writeText(allItems.map((item) => item.url).join("\n"));
document.querySelector("#clear").onclick = async () => {
  await chrome.runtime.sendMessage({ action: "clear", tabId: activeTabId });
  allItems = [];
  render();
};

refresh();
