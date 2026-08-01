function httpUrl(value) {
  if (!value || !/^https?:/i.test(value)) return null;
  try { return new URL(value, location.href).href; } catch { return null; }
}

function collectPreviews() {
  const posters = [];
  for (const video of document.querySelectorAll("video")) {
    const poster = httpUrl(video.poster);
    if (poster) posters.push(poster);
  }
  return { posters: [...new Set(posters)] };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "previews") sendResponse(collectPreviews());
});
