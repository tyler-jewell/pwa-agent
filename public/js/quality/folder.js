/** Optional project folder bind for quality file scans. Persist handle when allowed. */
import { kvGet, kvSet } from "../ports/storage.js";

const HANDLE_KEY = "projectFolderHandle";

export function createFolderBind() {
  let root = null;

  async function tryRestore() {
    try {
      const handle = await kvGet(HANDLE_KEY);
      if (!handle || typeof handle.queryPermission !== "function") return false;
      let perm = await handle.queryPermission({ mode: "read" });
      if (perm !== "granted") {
        perm = await handle.requestPermission({ mode: "read" });
      }
      if (perm === "granted") {
        root = handle;
        return true;
      }
    } catch {
      /* unsupported or revoked */
    }
    return false;
  }

  async function bind({ mode = "read" } = {}) {
    if (!window.showDirectoryPicker) throw new Error("File System Access unavailable");
    root = await window.showDirectoryPicker({ mode });
    try {
      await kvSet(HANDLE_KEY, root);
    } catch {
      /* handle persistence optional */
    }
    return root.name;
  }

  async function ensureWritePermission() {
    if (!root?.requestPermission) return false;
    let perm = await root.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") {
      perm = await root.requestPermission({ mode: "readwrite" });
    }
    return perm === "granted";
  }

  async function writeText(pathParts, text) {
    if (!root) throw new Error("folder not bound");
    const ok = await ensureWritePermission();
    if (!ok) throw new Error("write permission denied");
    let dir = root;
    for (let i = 0; i < pathParts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(pathParts[i], { create: true });
    }
    const fh = await dir.getFileHandle(pathParts[pathParts.length - 1], {
      create: true,
    });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }

  function isBound() {
    return !!root;
  }

  async function readText(pathParts) {
    if (!root) return null;
    let dir = root;
    for (let i = 0; i < pathParts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(pathParts[i]);
    }
    const fh = await dir.getFileHandle(pathParts[pathParts.length - 1]);
    const file = await fh.getFile();
    return file.text();
  }

  async function exists(pathParts) {
    try {
      await readText(pathParts);
      return true;
    } catch {
      return false;
    }
  }

  async function* walk(dirHandle, base = "") {
    for await (const [name, entry] of dirHandle.entries()) {
      const path = base ? `${base}/${name}` : name;
      if (entry.kind === "directory") {
        if (name === "node_modules" || name === ".git") continue;
        yield* walk(entry, path);
      } else {
        yield { path, entry };
      }
    }
  }

  async function scanSources() {
    if (!root) return [];
    const out = [];
    let start = root;
    let prefix = "";
    try {
      start = await root.getDirectoryHandle("public");
      prefix = "public/";
    } catch {
      /* use root */
    }
    for await (const { path, entry } of walk(start, prefix.replace(/\/$/, ""))) {
      if (!/\.(js|css|html)$/i.test(path)) continue;
      try {
        const file = await entry.getFile();
        const text = await file.text();
        const lines = text.split(/\n/).length;
        out.push({ path, text, lines });
      } catch {
        /* skip */
      }
    }
    return out;
  }

  async function hasDocsTree() {
    if (!root) return false;
    try {
      await root.getDirectoryHandle("docs");
      return true;
    } catch {
      return false;
    }
  }

  return {
    bind,
    tryRestore,
    isBound,
    readText,
    writeText,
    exists,
    scanSources,
    hasDocsTree,
  };
}
