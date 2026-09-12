let busy = false;

function isTypingTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

function getVideoId() {
  const url = new URL(location.href);
  if (url.pathname === '/watch') return url.searchParams.get('v') || location.href;
  if (url.pathname.startsWith('/shorts/')) return url.pathname.split('/')[2] || location.href;
  return location.href;
}

function getVideoTitle() {
  const title = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim()
    || document.querySelector('h1.title yt-formatted-string')?.textContent?.trim()
    || document.querySelector('meta[name="title"]')?.content?.trim()
    || document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim();
  return title || 'YouTube Video';
}

function toast(text, isError = false) {
  const old = document.getElementById('__yt_ss_toast');
  if (old) old.remove();
  const el = document.createElement('div');
  el.id = '__yt_ss_toast';
  el.textContent = text;
  Object.assign(el.style, {
    position: 'fixed',
    zIndex: '2147483647',
    left: '50%',
    bottom: '80px',
    transform: 'translateX(-50%)',
    background: isError ? 'rgba(160, 20, 20, .95)' : 'rgba(20, 20, 20, .92)',
    color: '#fff',
    padding: '10px 14px',
    borderRadius: '9px',
    font: '600 13px system-ui, sans-serif',
    boxShadow: '0 4px 20px rgba(0,0,0,.35)',
    pointerEvents: 'none'
  });
  document.documentElement.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

async function cropScreenshot(dataUrl, rect) {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = dataUrl;
  });

  const scaleX = img.naturalWidth / window.innerWidth;
  const scaleY = img.naturalHeight / window.innerHeight;
  const sx = Math.max(0, Math.round(rect.left * scaleX));
  const sy = Math.max(0, Math.round(rect.top * scaleY));
  const sw = Math.min(img.naturalWidth - sx, Math.round(rect.width * scaleX));
  const sh = Math.min(img.naturalHeight - sy, Math.round(rect.height * scaleY));

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, sw);
  canvas.height = Math.max(1, sh);
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.95), width: sw, height: sh };
}

async function takeScreenshot() {
  if (busy) return;
  busy = true;
  try {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) throw new Error('No YouTube video found.');
    const rect = video.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) throw new Error('Video is not visible.');

    const capture = await chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB' });
    if (!capture?.ok) throw new Error(capture?.error || 'Could not capture tab.');

    const cropped = await cropScreenshot(capture.dataUrl, rect);
    const result = await chrome.runtime.sendMessage({
      type: 'SAVE_SCREENSHOT',
      payload: {
        videoId: getVideoId(),
        videoTitle: getVideoTitle(),
        videoUrl: location.href,
        timestamp: Number(video.currentTime || 0),
        jpegDataUrl: cropped.dataUrl,
        width: cropped.width,
        height: cropped.height
      }
    });
    if (!result?.ok) throw new Error(result?.error || 'Could not save screenshot.');
    toast(`Saved screenshot ${String(result.number).padStart(3, '0')}.jpg`);
  } catch (error) {
    console.error('[YouTube Screenshot Library]', error);
    toast(error.message || 'Screenshot failed', true);
  } finally {
    busy = false;
  }
}

document.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() !== 'p' || event.repeat) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (isTypingTarget(event.target)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  takeScreenshot();
}, true);
