const DB_NAME = "youtube-screenshot-library";
const DB_VERSION = 1;
const STORE = "screenshots";
let all = [];
let currentVideoId = null;
const selected = new Set();
const objectUrls = new Map();

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, {
          keyPath: "id",
          autoIncrement: true,
        });

        store.createIndex("videoId", "videoId", { unique: false });
        store.createIndex("videoId_number", ["videoId", "number"], {
          unique: true,
        });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function reqPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadAll() {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");

  all = await reqPromise(tx.objectStore(STORE).getAll());

  db.close();

  all.sort((a, b) => a.createdAt - b.createdAt);
}

function formatTime(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));

  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const h = Math.floor(m / 60);

  if (h) {
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  return `${m}:${String(s).padStart(2, "0")}`;
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

function cleanupUrls() {
  for (const url of objectUrls.values()) {
    URL.revokeObjectURL(url);
  }

  objectUrls.clear();
}

function videos() {
  const map = new Map();

  for (const x of all) {
    if (!map.has(x.videoId)) {
      map.set(x.videoId, {
        videoId: x.videoId,
        title: x.videoTitle,
        count: 0,
        last: 0,
      });
    }

    const v = map.get(x.videoId);

    v.count++;
    v.last = Math.max(v.last, x.createdAt);
  }

  return [...map.values()].sort((a, b) => b.last - a.last);
}

function render() {
  cleanupUrls();

  const vs = videos();

  const list = document.getElementById("videoList");

  list.innerHTML = "";

  if (!currentVideoId && vs.length) {
    currentVideoId = vs[0].videoId;
  }

  if (currentVideoId && !vs.some((v) => v.videoId === currentVideoId)) {
    currentVideoId = vs[0]?.videoId || null;
  }

  for (const v of vs) {
    const btn = document.createElement("button");

    btn.className =
      "videoItem" + (v.videoId === currentVideoId ? " active" : "");

    btn.innerHTML = `
      <span class="videoItemTitle"></span>
      <span class="videoItemCount">
        ${v.count} screenshot${v.count === 1 ? "" : "s"}
      </span>
    `;

    btn.querySelector(".videoItemTitle").textContent = v.title;

    btn.onclick = () => {
      currentVideoId = v.videoId;
      selected.clear();
      render();
    };

    list.appendChild(btn);
  }

  const shown = all
    .filter((x) => x.videoId === currentVideoId)
    .sort((a, b) => a.number - b.number);

  document.getElementById("currentTitle").textContent =
    shown[0]?.videoTitle || "No screenshots yet";

  document.getElementById("countText").textContent = shown.length
    ? `${shown.length} screenshot${shown.length === 1 ? "" : "s"} • ${selected.size} selected`
    : "";

  const grid = document.getElementById("grid");

  grid.innerHTML = "";

  document.getElementById("empty").classList.toggle("show", shown.length === 0);

  for (const x of shown) {
    const card = document.createElement("article");

    card.className = "card" + (selected.has(x.id) ? " selected" : "");

    const check = document.createElement("input");

    check.type = "checkbox";
    check.className = "check";
    check.checked = selected.has(x.id);

    check.onchange = () => {
      if (check.checked) {
        selected.add(x.id);
      } else {
        selected.delete(x.id);
      }

      render();
    };

    const img = document.createElement("img");

    img.className = "thumb";

    const url = URL.createObjectURL(x.blob);

    objectUrls.set(x.id, url);

    img.src = url;

    const meta = document.createElement("div");

    meta.className = "meta";

    meta.innerHTML = `
      <span>
        #${String(x.number).padStart(3, "0")}
      </span>

      <span>
        ${formatTime(x.timestamp)}
      </span>
    `;

    card.append(check, img, meta);

    card.onclick = (e) => {
      if (e.target === check) {
        return;
      }

      if (selected.has(x.id)) {
        selected.delete(x.id);
      } else {
        selected.add(x.id);
      }

      render();
    };

    grid.appendChild(card);
  }
}

function concatBytes(parts) {
  const total = parts.reduce((s, p) => s + p.length, 0);

  const out = new Uint8Array(total);

  let offset = 0;

  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }

  return out;
}

function strBytes(s) {
  return new TextEncoder().encode(s);
}

async function blobBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

async function createPdf(items, slidesPerPage = 1) {
  const objects = [];

  const addObject = (parts) => {
    objects.push(parts);
    return objects.length;
  };

  const pageIds = [];
  const pageImageIds = [];
  const contentIds = [];

  const catalogId = addObject([]);

  const pagesId = addObject([]);

  const pageW = 612;
  const pageH = 792;

  const margin = 24;
  const gap = 16;

  for (let start = 0; start < items.length; start += slidesPerPage) {
    const pageItems = items.slice(start, start + slidesPerPage);

    const imageIds = [];
    const drawCommands = [];

    const availableHeight = pageH - margin * 2 - gap * (pageItems.length - 1);

    const slotHeight = availableHeight / pageItems.length;

    for (let i = 0; i < pageItems.length; i++) {
      const item = pageItems[i];

      const jpeg = await blobBytes(item.blob);

      const w = Number(item.width) || 1280;

      const h = Number(item.height) || 720;

      const imageId = addObject([
        strBytes(
          `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>
stream
`,
        ),

        jpeg,

        strBytes("\nendstream"),
      ]);

      imageIds.push(imageId);

      const scale = Math.min(
        (pageW - margin * 2) / w,

        slotHeight / h,
      );

      const dw = w * scale;

      const dh = h * scale;

      const x = (pageW - dw) / 2;

      const slotTop = pageH - margin - i * (slotHeight + gap);

      const y = slotTop - slotHeight + (slotHeight - dh) / 2;

      drawCommands.push(
        `q
${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm
/Im${i} Do
Q
`,
      );
    }

    const content = drawCommands.join("");

    const cb = strBytes(content);

    const contentId = addObject([
      strBytes(
        `<< /Length ${cb.length} >>
stream
`,
      ),

      cb,

      strBytes("endstream"),
    ]);

    const pageId = addObject([]);

    pageImageIds.push(imageIds);

    contentIds.push(contentId);

    pageIds.push(pageId);
  }

  objects[catalogId - 1] = [
    strBytes(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`),
  ];

  objects[pagesId - 1] = [
    strBytes(
      `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds
        .map((id) => `${id} 0 R`)
        .join(" ")}] >>`,
    ),
  ];

  for (let i = 0; i < pageIds.length; i++) {
    const xObjects = pageImageIds[i]
      .map((id, index) => `/Im${index} ${id} 0 R`)
      .join(" ");

    objects[pageIds[i] - 1] = [
      strBytes(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /XObject << ${xObjects} >> >> /Contents ${contentIds[i]} 0 R >>`,
      ),
    ];
  }

  const chunks = [strBytes("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];

  const offsets = [0];

  let length = chunks[0].length;

  for (let i = 0; i < objects.length; i++) {
    offsets.push(length);

    const head = strBytes(`${i + 1} 0 obj\n`);

    const tail = strBytes("\nendobj\n");

    chunks.push(head, ...objects[i], tail);

    length +=
      head.length + objects[i].reduce((s, p) => s + p.length, 0) + tail.length;
  }

  const xrefOffset = length;

  let xref = `xref
0 ${objects.length + 1}
0000000000 65535 f 
`;

  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n 
`;
  }

  xref += `trailer
<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>
startxref
${xrefOffset}
%%EOF`;

  chunks.push(strBytes(xref));

  return new Blob([concatBytes(chunks)], {
    type: "application/pdf",
  });
}

async function exportPdf() {
  const items = all
    .filter((x) => selected.has(x.id))
    .sort((a, b) => a.number - b.number);

  if (!items.length) {
    return alert("Select at least one screenshot first.");
  }

  const slidesPerPage = Number(
    document.getElementById("slidesPerPage")?.value || 1,
  );

  const pdf = await createPdf(items, slidesPerPage);

  const folder = sanitizeFolderName(items[0].videoTitle);

  const url = URL.createObjectURL(pdf);

  try {
    await chrome.downloads.download({
      url,

      filename: `YouTube Screenshots/${folder}/${folder} - screenshots.pdf`,

      saveAs: false,

      conflictAction: "overwrite",
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }
}

async function deleteSelected() {
  if (!selected.size) {
    return;
  }

  if (
    !confirm(
      `Delete ${selected.size} selected screenshot(s) from the extension library? This does not delete already-downloaded JPEG files.`,
    )
  ) {
    return;
  }

  const db = await openDb();

  const tx = db.transaction(STORE, "readwrite");

  const store = tx.objectStore(STORE);

  for (const id of selected) {
    store.delete(id);
  }

  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;

    tx.onerror = () => reject(tx.error);
  });

  db.close();

  selected.clear();

  await loadAll();

  render();
}

async function getImageDimensions(file) {
  try {
    const bitmap = await createImageBitmap(file);

    const dimensions = {
      width: bitmap.width,
      height: bitmap.height,
    };

    bitmap.close();

    return dimensions;
  } catch {
    return {
      width: 1280,
      height: 720,
    };
  }
}

function parseScreenshotNumber(fileName) {
  const match = fileName.match(/^(\d+)\.(jpe?g)$/i);

  if (!match) {
    return null;
  }

  return Number(match[1]);
}

async function importScreenshotLibrary() {
  if (!("showDirectoryPicker" in window)) {
    alert("Folder import is not supported in this version of Chrome.");
    return;
  }

  let rootHandle;

  try {
    rootHandle = await window.showDirectoryPicker({
      mode: "read",
    });
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.error("Unable to open screenshot folder:", error);

      alert("Could not open the selected folder.");
    }

    return;
  }

  const importButton = document.getElementById("importLibrary");

  const originalText = importButton?.textContent || "Import Screenshot Library";

  if (importButton) {
    importButton.disabled = true;
    importButton.textContent = "Importing...";
  }

  let importedCount = 0;
  let skippedCount = 0;
  let folderCount = 0;

  try {
    const db = await openDb();

    for await (const [folderName, handle] of rootHandle.entries()) {
      if (handle.kind !== "directory") {
        continue;
      }

      folderCount++;

      const videoTitle = folderName;

      /*
       * Since we don't know the original YouTube video ID
       * from the folder alone, imported folders receive a
       * stable ID based on the folder name.
       */
      const videoId = `imported:${folderName}`;

      const files = [];

      for await (const [fileName, fileHandle] of handle.entries()) {
        if (fileHandle.kind !== "file") {
          continue;
        }

        /*
         * Only accepts:
         *
         * 001.jpg
         * 002.jpg
         * 003.jpeg
         * etc.
         */
        const number = parseScreenshotNumber(fileName);

        if (number === null) {
          continue;
        }

        files.push({
          number,
          fileHandle,
        });
      }

      files.sort((a, b) => a.number - b.number);

      for (const entry of files) {
        /*
         * Check whether this screenshot was
         * already imported.
         */
        const existingTx = db.transaction(STORE, "readonly");

        const existingStore = existingTx.objectStore(STORE);

        const existingIndex = existingStore.index("videoId_number");

        const existing = await reqPromise(
          existingIndex.get([videoId, entry.number]),
        );

        if (existing) {
          skippedCount++;
          continue;
        }

        const file = await entry.fileHandle.getFile();

        const dimensions = await getImageDimensions(file);

        const record = {
          videoId,
          videoTitle,

          number: entry.number,

          createdAt: file.lastModified || Date.now(),

          /*
           * Timestamp cannot be reconstructed
           * from the JPEG filename, so imported
           * screenshots use 0.
           */
          timestamp: 0,

          width: dimensions.width,

          height: dimensions.height,

          blob: file,

          imported: true,
        };

        const writeTx = db.transaction(STORE, "readwrite");

        const writeStore = writeTx.objectStore(STORE);

        await reqPromise(writeStore.add(record));

        importedCount++;
      }
    }

    db.close();

    /*
     * Refresh gallery.
     */
    selected.clear();

    currentVideoId = null;

    await loadAll();

    render();

    if (folderCount === 0) {
      alert(
        "No video folders were found. Select the main YouTube Screenshots folder that contains one subfolder per video.",
      );

      return;
    }

    alert(
      `Import complete. ${importedCount} screenshot(s) imported and ${skippedCount} duplicate(s) skipped.`,
    );
  } catch (error) {
    console.error("Screenshot library import failed:", error);

    alert(`Import failed: ${error?.message || "Unknown error"}`);
  } finally {
    if (importButton) {
      importButton.disabled = false;

      importButton.textContent = originalText;
    }
  }
}

/*
 * Add Import button beside Select All.
 */
const selectAllButton = document.getElementById("selectAll");

if (selectAllButton && !document.getElementById("importLibrary")) {
  const importButton = document.createElement("button");

  importButton.id = "importLibrary";

  importButton.type = "button";

  importButton.textContent = "Import Screenshot Library";

  importButton.title = "Choose your existing YouTube Screenshots folder";

  importButton.onclick = importScreenshotLibrary;

  selectAllButton.parentNode.insertBefore(importButton, selectAllButton);
}

/*
 * PDF layout selector
 */
const exportPdfButton = document.getElementById("exportPdf");

if (exportPdfButton && !document.getElementById("slidesPerPage")) {
  const wrapper = document.createElement("label");

  wrapper.style.display = "inline-flex";

  wrapper.style.alignItems = "center";

  wrapper.style.gap = "8px";

  wrapper.style.marginRight = "10px";

  wrapper.textContent = "Slides per PDF page";

  const select = document.createElement("select");

  select.id = "slidesPerPage";

  select.setAttribute("aria-label", "Slides per PDF page");

  select.innerHTML = `
    <option value="1" selected>
      1
    </option>

    <option value="2">
      2
    </option>
  `;

  select.style.padding = "8px 10px";

  select.style.borderRadius = "8px";

  select.style.border = "1px solid currentColor";

  select.style.background = "transparent";

  select.style.color = "inherit";

  wrapper.appendChild(select);

  exportPdfButton.parentNode.insertBefore(wrapper, exportPdfButton);
}

document.getElementById("selectAll").onclick = () => {
  for (const x of all.filter((x) => x.videoId === currentVideoId)) {
    selected.add(x.id);
  }

  render();
};

document.getElementById("clearSelection").onclick = () => {
  selected.clear();
  render();
};

document.getElementById("exportPdf").onclick = exportPdf;

document.getElementById("deleteSelected").onclick = deleteSelected;

(async () => {
  await loadAll();
  render();
})();
