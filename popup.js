document.getElementById('gallery').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_GALLERY' });
  window.close();
});
