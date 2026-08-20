/* ==========================================================================
   idb.js — IndexedDB blob storage for attachments

   localStorage tops out around 5 MB and only holds strings, so files live here
   instead. Metadata (name, size, owner) stays in the main store so it syncs
   and exports; the bytes stay local unless the user is signed in, in which
   case sync.js can push them to Netlify Blobs.
   ========================================================================== */

App.idb = (function () {
  const DB_NAME = "scholar-files";
  const STORE = "files";
  const VERSION = 1;
  const MAX_BYTES = 25 * 1024 * 1024;   // per file

  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("IndexedDB isn't available in this browser."));
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("Couldn't open local file storage."));
    });
    return dbp;
  }

  function tx(mode, fn) {
    return open().then((d) => new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let result;
      try { result = fn(store); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("Storage transaction aborted."));
    }));
  }

  /** Store a File/Blob. Returns the generated id. */
  function put(id, blob) {
    if (blob.size > MAX_BYTES) {
      return Promise.reject(new Error(`That file is ${(blob.size / 1048576).toFixed(1)} MB — the limit is 25 MB.`));
    }
    return tx("readwrite", (s) => s.put({ id, blob, savedAt: Date.now() })).then(() => id);
  }

  function get(id) {
    return tx("readonly", (s) => s.get(id)).then((rec) => (rec ? rec.blob : null));
  }

  function del(id) {
    return tx("readwrite", (s) => s.delete(id));
  }

  function keys() {
    return tx("readonly", (s) => s.getAllKeys());
  }

  /** Total bytes held locally — shown in Settings. */
  function usage() {
    return tx("readonly", (s) => s.getAll()).then((all) =>
      (all || []).reduce((n, r) => n + (r.blob ? r.blob.size : 0), 0));
  }

  /** Remove blobs whose metadata record is gone. */
  function gc(validIds) {
    const keep = new Set(validIds);
    return keys().then((all) =>
      Promise.all((all || []).filter((k) => !keep.has(k)).map(del)));
  }

  /** Open a stored file in a new tab (revoked shortly after). */
  function openFile(id, name) {
    return get(id).then((blob) => {
      if (!blob) throw new Error("That file isn't stored on this device.");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      if (name) a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 20000);
    });
  }

  /** Data URL for inline image previews. */
  function dataUrl(id) {
    return get(id).then((blob) => {
      if (!blob) return null;
      return new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => resolve(null);
        fr.readAsDataURL(blob);
      });
    });
  }

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  return { put, get, del, keys, usage, gc, openFile, dataUrl, fmtSize, MAX_BYTES };
})();
