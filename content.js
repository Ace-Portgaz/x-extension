function absoluteUrl(value) {
  if (!value || value.startsWith("blob:") || value.startsWith("data:")) return null;
  try {
    return new URL(value, location.href).href;
  } catch {
    return null;
  }
}

function collectPreviews() {
  const exact = {};
  const videoPosters = [];

  for (const img of document.images) {
    const src = absoluteUrl(img.currentSrc || img.src);
    if (src) exact[src] = src;
  }

  for (const video of document.querySelectorAll("video")) {
    const poster = absoluteUrl(video.poster);
    const sources = [video.currentSrc, video.src, ...[...video.querySelectorAll("source")].map((item) => item.src)]
      .map(absoluteUrl)
      .filter(Boolean);
    if (poster) {
      videoPosters.push(poster);
      for (const source of sources) exact[source] = poster;
    }
  }

  return { exact, videoPosters: [...new Set(videoPosters)] };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "previews") sendResponse(collectPreviews());
});
