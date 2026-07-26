/**
 * Plugin registry — general-purpose installed plugins (not user-specific).
 */
import { emit, EVT } from "../core/events.js";
import { kvGet, kvSet } from "../ports/storage.js";

const KEY = "installedPlugins";

export function createPluginRegistry() {
  /** @type {Map<string, object>} */
  const plugins = new Map();
  /** @type {Set<string>} */
  let installedIds = new Set();

  async function load() {
    try {
      const saved = (await kvGet(KEY)) || [];
      installedIds = new Set(Array.isArray(saved) ? saved : []);
    } catch {
      installedIds = new Set();
    }
    return list();
  }

  async function persist() {
    try {
      await kvSet(KEY, [...installedIds]);
    } catch {
      /* ignore */
    }
  }

  function register(plugin) {
    if (!plugin?.id) return;
    if (plugin.general === false) {
      console.warn("[plugins] refusing non-general plugin", plugin.id);
      return;
    }
    plugins.set(plugin.id, plugin);
  }

  async function install(pluginId) {
    const p = plugins.get(pluginId);
    if (!p) return { ok: false, error: `unknown plugin ${pluginId}` };
    if (p.general === false) return { ok: false, error: "not general" };
    installedIds.add(pluginId);
    await persist();
    emit(EVT.PILL, { level: "ok", message: `plugin installed: ${pluginId}` });
    emit("plugin-installed", { pluginId, general: true });
    return { ok: true, pluginId, general: true };
  }

  function isInstalled(id) {
    return installedIds.has(id);
  }

  function get(id) {
    return plugins.get(id) || null;
  }

  function list() {
    return [...plugins.values()].map((p) => ({
      id: p.id,
      title: p.title,
      general: p.general !== false,
      installed: installedIds.has(p.id),
      scopes: p.scopes || [],
    }));
  }

  function listInstalled() {
    return list().filter((p) => p.installed);
  }

  return {
    load,
    register,
    install,
    isInstalled,
    get,
    list,
    listInstalled,
  };
}
