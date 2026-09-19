const DB_NAME = "youtube-screenshot-library";
const DB_VERSION = 1;
const STORE = "screenshots";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;

      let store;

      if (!db.objectStoreNames.contains(STORE)) {
        store = db.createObjectStore(STORE, {
          keyPath: "id",
          autoIncrement: true,
        });

        store.createIndex("videoId", "videoId", {
          unique: false,
        });

        store.createIndex(
          "videoId_folder_number",
          ["videoId", "folder", "number"],
          {
            unique: true,
          },
        );

        store.createIndex("createdAt", "createdAt", {
          unique: false,
        });
      } else {
        store = req.transaction.objectStore(STORE);

        if (store.indexNames.contains("videoId_number")) {
          store.deleteIndex("videoId_number");
        }

        if (!store.indexNames.contains("videoId_folder_number")) {
          store.createIndex(
            "videoId_folder_number",
            ["videoId", "folder", "number"],
            {
              unique: true,
            },
          );
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txComplete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
  });
}

function sanitizeFolderName(name) {
  return (
    (name || "YouTube Video")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
      .replace(/[. ]+$/g, "")
      .trim()
      .slice(0, 120) || "YouTube Video"
  );
}

async function getNextNumber(videoId) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const index = tx.objectStore(STORE).index("videoId");
  const req = index.getAll(IDBKeyRange.only(videoId));
  const items = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  await txComplete(tx);
  db.close();
  return items.reduce((max, x) => Math.max(max, Number(x.number) || 0), 0) + 1;
}

async function saveRecord(record) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const req = tx.objectStore(STORE).add(record);
  const id = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await txComplete(tx);
  db.close();
  return id;
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mime =
    (header.match(/data:([^;]+)/) || [])[1] || "application/octet-stream";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "CAPTURE_VISIBLE_TAB") {
    (async () => {
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(
          sender.tab.windowId,
          {
            format: "jpeg",
            quality: 95,
          },
        );
        sendResponse({ ok: true, dataUrl });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (message?.type === "SAVE_SCREENSHOT") {
    (async () => {
      try {
        const {
          videoId,
          videoTitle,
          videoUrl,
          timestamp,
          jpegDataUrl,
          width,
          height,
        } = message.payload;
        const number = await getNextNumber(videoId);
        const blob = dataUrlToBlob(jpegDataUrl);
        const folder = sanitizeFolderName(videoTitle);
        const fileName = `${String(number).padStart(3, "0")}.jpg`;
        const relativePath = `YouTube Screenshots/${folder}/${fileName}`;

        const id = await saveRecord({
          videoId,
          videoTitle,
          videoUrl,
          timestamp,
          number,
          width,
          height,
          createdAt: Date.now(),
          blob,
          folder: "original",
        });

        await chrome.downloads.download({
          url: jpegDataUrl,
          filename: relativePath,
          saveAs: false,
          conflictAction: "overwrite",
        });

        sendResponse({ ok: true, id, number, relativePath });
      } catch (error) {
        console.error(error);
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (message?.type === "OPEN_GALLERY") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
});
