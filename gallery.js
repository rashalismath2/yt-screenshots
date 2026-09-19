const DB_NAME = "youtube-screenshot-library";
const DB_VERSION = 2;
const STORE = "screenshots";
let all = [];

let currentVideoId = null;
let currentFolder = "original";

const selected = new Set();
const objectUrls = new Map();

let cropTargetId = null;
let cropRect = null;
let cropDragStart = null;

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

function folderKey(item) {
  return item.folder || "original";
}

function videos() {
  const map = new Map();

  for (const x of all) {
    if (!map.has(x.videoId)) {
      map.set(x.videoId, {
        videoId: x.videoId,
        title: x.videoTitle,
        last: 0,

        folders: new Map(),
      });
    }

    const video = map.get(x.videoId);

    const folder = folderKey(x);

    if (!video.folders.has(folder)) {
      video.folders.set(folder, {
        name: folder,
        count: 0,
        last: 0,
      });
    }

    const f = video.folders.get(folder);

    f.count++;

    f.last = Math.max(f.last, x.createdAt);

    video.last = Math.max(video.last, x.createdAt);
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

    currentFolder = vs[0].folders.has("original")
      ? "original"
      : [...vs[0].folders.keys()][0];
  }

  if (currentVideoId && !vs.some((v) => v.videoId === currentVideoId)) {
    currentVideoId = vs[0]?.videoId || null;
  }

  const currentVideo = vs.find((v) => v.videoId === currentVideoId);

  if (currentVideo && !currentVideo.folders.has(currentFolder)) {
    currentFolder = currentVideo.folders.has("original")
      ? "original"
      : [...currentVideo.folders.keys()][0];
  }

  for (const v of vs) {
    const wrapper = document.createElement("div");

    wrapper.className = "videoGroup";

    const title = document.createElement("div");

    title.className = "videoGroupTitle";

    title.textContent = v.title;

    wrapper.appendChild(title);

    const folders = [...v.folders.values()].sort((a, b) => {
      if (a.name === "original") return -1;

      if (b.name === "original") return 1;

      return a.name.localeCompare(b.name);
    });

    for (const folder of folders) {
      const btn = document.createElement("button");

      const isActive =
        v.videoId === currentVideoId && folder.name === currentFolder;

      btn.className = "videoItem folderItem" + (isActive ? " active" : "");

      btn.innerHTML = `
      <span class="videoItemTitle"></span>

      <span class="videoItemCount">
        ${folder.count}
        screenshot${folder.count === 1 ? "" : "s"}
      </span>
    `;

      btn.querySelector(".videoItemTitle").textContent =
        folder.name === "original" ? "Original" : folder.name;

      btn.onclick = () => {
        currentVideoId = v.videoId;

        currentFolder = folder.name;

        selected.clear();

        render();
      };

      wrapper.appendChild(btn);
    }

    list.appendChild(wrapper);
  }

  const shown = all
    .filter(
      (x) => x.videoId === currentVideoId && folderKey(x) === currentFolder,
    )
    .sort((a, b) => a.number - b.number);

  document.getElementById("currentTitle").textContent = shown.length
    ? `${shown[0].videoTitle} / ${
        currentFolder === "original" ? "Original" : currentFolder
      }`
    : "No screenshots yet";

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

    img.ondblclick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      openCropModal(x.id);
    };

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

function getCurrentFolderItems() {
  return all
    .filter(
      (x) => x.videoId === currentVideoId && folderKey(x) === currentFolder,
    )
    .sort((a, b) => a.number - b.number);
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;

    tx.onerror = () => reject(tx.error);

    tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
  });
}

function resetCropSelection() {
  cropRect = null;

  cropDragStart = null;

  const selection = document.getElementById("cropSelection");

  selection.style.display = "none";

  document.getElementById("cropSelectionText").textContent =
    "Drag to select an area";
}

function updateCropSelection() {
  if (!cropRect) return;

  const selection = document.getElementById("cropSelection");

  selection.style.display = "block";

  selection.style.left = `${cropRect.x}px`;

  selection.style.top = `${cropRect.y}px`;

  selection.style.width = `${cropRect.width}px`;

  selection.style.height = `${cropRect.height}px`;

  document.getElementById("cropSelectionText").textContent =
    `${Math.round(cropRect.width)} × ${Math.round(cropRect.height)}`;
}

function openCropModal(id) {
  const item = all.find((x) => x.id === id);

  if (!item) return;

  cropTargetId = id;

  resetCropSelection();

  const modal = document.getElementById("cropModal");

  const img = document.getElementById("cropImage");

  if (img.dataset.objectUrl) {
    URL.revokeObjectURL(img.dataset.objectUrl);
  }

  const url = URL.createObjectURL(item.blob);

  img.dataset.objectUrl = url;

  img.src = url;

  modal.classList.add("show");
}

function closeCropModal() {
  const modal = document.getElementById("cropModal");

  const img = document.getElementById("cropImage");

  modal.classList.remove("show");

  if (img.dataset.objectUrl) {
    URL.revokeObjectURL(img.dataset.objectUrl);

    delete img.dataset.objectUrl;
  }

  cropTargetId = null;

  resetCropSelection();
}

function getStagePoint(event) {
  const stage = document.getElementById("cropStage");

  const rect = stage.getBoundingClientRect();

  return {
    x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),

    y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
  };
}

function installCropEvents() {
  const stage = document.getElementById("cropStage");

  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;

    event.preventDefault();

    stage.setPointerCapture(event.pointerId);

    cropDragStart = getStagePoint(event);

    cropRect = {
      x: cropDragStart.x,

      y: cropDragStart.y,

      width: 0,

      height: 0,
    };

    updateCropSelection();
  });

  stage.addEventListener("pointermove", (event) => {
    if (!cropDragStart) return;

    const point = getStagePoint(event);

    cropRect = {
      x: Math.min(cropDragStart.x, point.x),

      y: Math.min(cropDragStart.y, point.y),

      width: Math.abs(point.x - cropDragStart.x),

      height: Math.abs(point.y - cropDragStart.y),
    };

    updateCropSelection();
  });

  stage.addEventListener("pointerup", (event) => {
    if (!cropDragStart) return;

    stage.releasePointerCapture(event.pointerId);

    cropDragStart = null;

    if (cropRect.width < 5 || cropRect.height < 5) {
      resetCropSelection();
    }
  });
}
async function cropItem(item, selection) {
  const preview = document.getElementById("cropImage");

  const previewWidth = preview.clientWidth;

  const previewHeight = preview.clientHeight;

  const originalWidth = Number(item.width) || preview.naturalWidth;

  const originalHeight = Number(item.height) || preview.naturalHeight;

  /*
   * Convert the selected region
   * into percentages.
   *
   * This allows Apply to All
   * to work on different image sizes.
   */

  const xPercent = selection.x / previewWidth;

  const yPercent = selection.y / previewHeight;

  const widthPercent = selection.width / previewWidth;

  const heightPercent = selection.height / previewHeight;

  const bitmap = await createImageBitmap(item.blob);

  try {
    const sx = Math.round(bitmap.width * xPercent);

    const sy = Math.round(bitmap.height * yPercent);

    const sw = Math.round(bitmap.width * widthPercent);

    const sh = Math.round(bitmap.height * heightPercent);

    const canvas = document.createElement("canvas");

    canvas.width = sw;

    canvas.height = sh;

    const ctx = canvas.getContext("2d", {
      alpha: false,
    });

    ctx.drawImage(
      bitmap,

      sx,
      sy,
      sw,
      sh,

      0,
      0,
      sw,
      sh,
    );

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) resolve(result);
          else reject(new Error("Crop failed"));
        },

        "image/jpeg",

        0.95,
      );
    });

    return {
      blob,

      width: canvas.width,

      height: canvas.height,
    };
  } finally {
    bitmap.close();
  }
}
async function saveCroppedItem(source, cropped) {
  const db = await openDb();

  const tx = db.transaction(STORE, "readwrite");

  const store = tx.objectStore(STORE);

  /*
   * If this image was already cropped,
   * replace the previous cropped copy.
   */

  const oldCrops = all.filter(
    (x) =>
      x.videoId === source.videoId &&
      folderKey(x) === "cropped" &&
      x.sourceId === source.id,
  );

  for (const old of oldCrops) {
    store.delete(old.id);
  }

  store.add({
    videoId: source.videoId,

    videoTitle: source.videoTitle,

    videoUrl: source.videoUrl,

    timestamp: source.timestamp,

    number: source.number,

    width: cropped.width,

    height: cropped.height,

    createdAt: Date.now(),

    blob: cropped.blob,

    folder: "cropped",

    sourceId: source.id,
  });

  await txDone(tx);

  db.close();

  /*
   * Also download it physically.
   */

  const folder = sanitizeFolderName(source.videoTitle);

  const fileName = `${String(source.number).padStart(3, "0")}.jpg`;

  const url = URL.createObjectURL(cropped.blob);

  try {
    await chrome.downloads.download({
      url,

      filename: `YouTube Screenshots/${folder}/cropped/${fileName}`,

      saveAs: false,

      conflictAction: "overwrite",
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }
}
async function applyCrop(applyToAll) {
  if (!cropRect) {
    alert("Select a crop area first.");

    return;
  }

  const target = all.find((x) => x.id === cropTargetId);

  if (!target) return;

  let items;

  if (applyToAll) {
    items = getCurrentFolderItems();
  } else {
    items = [target];
  }

  const cropButton = document.getElementById("applyCropOne");

  const cropAllButton = document.getElementById("applyCropAll");

  cropButton.disabled = true;

  cropAllButton.disabled = true;

  try {
    for (const item of items) {
      const result = await cropItem(item, cropRect);

      await saveCroppedItem(item, result);
    }

    selected.clear();

    await loadAll();

    currentVideoId = target.videoId;

    currentFolder = "cropped";

    closeCropModal();

    render();
  } catch (error) {
    console.error(error);

    alert(error.message || "Crop failed.");
  } finally {
    cropButton.disabled = false;

    cropAllButton.disabled = false;
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

        const existingIndex = existingStore.index("videoId_folder_number");

        const existing = await reqPromise(
          existingIndex.get([videoId, "original", entry.number]),
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

          timestamp: 0,

          width: dimensions.width,

          height: dimensions.height,

          blob: file,

          imported: true,

          folder: "original",
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
  for (const x of getCurrentFolderItems()) {
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

document.getElementById("closeCropModal").onclick = closeCropModal;

document.getElementById("applyCropOne").onclick = () => {
  applyCrop(false);
};

document.getElementById("applyCropAll").onclick = () => {
  applyCrop(true);
};

document.getElementById("cropModal").onclick = (event) => {
  if (event.target.id === "cropModal") {
    closeCropModal();
  }
};

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeCropModal();
  }
});

installCropEvents();

(async () => {
  await loadAll();
  render();
})();
