/**
 * Local live update via File System Access API.
 * If bound root contains public/, watch only that subtree (README public/**).
 */
export function createLocalWatch({ onChange, intervalMs = 2000 } = {}) {
  let dirHandle = null;
  let timer = null;
  let snapshot = new Map();

  async function bind() {
    if (!window.showDirectoryPicker) {
      throw new Error("File System Access API not available in this browser");
    }
    const picked = await window.showDirectoryPicker({ mode: "read" });
    // Prefer public/ when user bound repo root
    try {
      dirHandle = await picked.getDirectoryHandle("public");
    } catch {
      dirHandle = picked;
    }
    snapshot = await scan(dirHandle);
    start();
    return dirHandle.name;
  }

  async function scan(handle, base = "") {
    const map = new Map();
    for await (const [name, entry] of handle.entries()) {
      const path = base ? `${base}/${name}` : name;
      if (entry.kind === "directory") {
        if (name === "node_modules" || name === ".git") continue;
        const sub = await scan(entry, path);
        for (const [k, v] of sub) map.set(k, v);
      } else if (entry.kind === "file") {
        if (!/\.(js|css|html|json|webmanifest|svg|png)$/i.test(name)) continue;
        try {
          const f = await entry.getFile();
          map.set(path, `${f.size}:${f.lastModified}`);
        } catch {
          /* permission */
        }
      }
    }
    return map;
  }

  function start() {
    stop();
    if (!dirHandle) return;
    timer = setInterval(async () => {
      try {
        const next = await scan(dirHandle);
        let changed = next.size !== snapshot.size;
        if (!changed) {
          for (const [k, v] of next) {
            if (snapshot.get(k) !== v) {
              changed = true;
              break;
            }
          }
        }
        if (changed) {
          snapshot = next;
          onChange?.({ source: "local-watch" });
        }
      } catch (e) {
        console.warn("[local-watch]", e);
      }
    }, intervalMs);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function isBound() {
    return !!dirHandle;
  }

  return { bind, start, stop, isBound };
}
