# YouTube Screenshot Library

Chrome Manifest V3 extension.

## Features

- Press **P** while watching YouTube to capture only the visible video area.
- Saves JPEGs as `YouTube Screenshots/<video title>/001.jpg`, `002.jpg`, etc.
- Keeps an internal screenshot library grouped by YouTube video.
- Extension popup opens the gallery.
- Select individual images or all images for a video.
- Export selected JPEGs to a PDF in the same per-video folder.
- PDFs contain one screenshot per page, fitted to the page without stretching.

## Install

1. Unzip this folder.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the `youtube-screenshot-extension` folder.
6. Open a YouTube video and press **P**.

## Saving on Desktop

Chrome's `downloads` extension API only accepts paths relative to Chrome's configured download directory. It cannot silently specify an arbitrary absolute Desktop path.

To make the extension save exactly on Desktop:

1. Open Chrome Settings -> Downloads.
2. Change **Location** to your Desktop folder.
3. Keep "Ask where to save each file before downloading" turned off.

The extension will then create:

`Desktop/YouTube Screenshots/<video title>/001.jpg`

and the PDF in that same video folder.

## Notes

- Pressing P is intercepted on YouTube unless focus is in an input/text field.
- Screenshots capture the visible video rectangle. If browser overlays are drawn over the video, they may appear in the screenshot.
- The extension library uses IndexedDB, so screenshots remain visible in the gallery after browser restarts unless extension storage is cleared.
