/**
 * Google Calendar plugin — GENERAL for any Google account.
 * No hardcoded user email/id. OAuth token client + Calendar API list.
 * Mock connect without Client ID proves the portable protocol.
 */
import { kvGet, kvSet } from "../ports/storage.js";

export const GOOGLE_CALENDAR_PLUGIN_ID = "google-calendar";
export const CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";
const TOKEN_KEY = "plugin.google-calendar.token";

/** In-memory fallback when IDB unavailable (Node tests). */
let memToken = null;

export function createGoogleCalendarPlugin({
  clientId = null,
  fetchImpl = null,
} = {}) {
  const fetchFn =
    fetchImpl ||
    (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);

  async function readToken() {
    try {
      const t = await kvGet(TOKEN_KEY);
      if (t) return t;
    } catch {
      /* */
    }
    return memToken;
  }

  async function writeToken(v) {
    memToken = v;
    try {
      await kvSet(TOKEN_KEY, v);
    } catch {
      /* */
    }
  }

  return {
    id: GOOGLE_CALENDAR_PLUGIN_ID,
    title: "Google Calendar (read)",
    general: true,
    provider: "google",
    scopes: [CALENDAR_SCOPE],
    clientId,

    async isAuthed() {
      const t = await readToken();
      return !!(t?.access_token && (!t.expires_at || t.expires_at > Date.now()));
    },

    async connect({ interactive = true } = {}) {
      const cid =
        clientId ||
        (typeof localStorage !== "undefined" &&
          localStorage.getItem("GOOGLE_CLIENT_ID")) ||
        null;

      if (!cid) {
        await writeToken({
          access_token: "mock-general-token",
          token_type: "Bearer",
          expires_at: Date.now() + 3600_000,
          scope: CALENDAR_SCOPE,
          mock: true,
        });
        return { ok: true, mock: true, general: true };
      }

      if (typeof google === "undefined" || !google?.accounts?.oauth2) {
        return {
          ok: false,
          error:
            "Google Identity Services not loaded. Set GOOGLE_CLIENT_ID + GIS script.",
        };
      }

      return new Promise((resolve) => {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: cid,
          scope: CALENDAR_SCOPE,
          callback: async (resp) => {
            if (resp.error) {
              resolve({ ok: false, error: resp.error });
              return;
            }
            await writeToken({
              access_token: resp.access_token,
              token_type: "Bearer",
              expires_at:
                Date.now() + (Number(resp.expires_in) || 3600) * 1000,
              scope: resp.scope || CALENDAR_SCOPE,
            });
            resolve({ ok: true, mock: false, general: true });
          },
        });
        client.requestAccessToken(
          interactive ? { prompt: "consent" } : undefined
        );
      });
    },

    async disconnect() {
      await writeToken(null);
      return { ok: true };
    },

    async listUpcoming({ days = 3, calendarId = "primary" } = {}) {
      const token = await readToken();
      if (!token?.access_token) {
        return { ok: false, error: "not_connected", needAuth: true };
      }

      const timeMin = new Date();
      const timeMax = new Date(timeMin.getTime() + days * 86400_000);

      if (token.mock) {
        return {
          ok: true,
          mock: true,
          general: true,
          calendarId,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          events: mockEvents(timeMin, days),
          note: "Mock events — GOOGLE_CLIENT_ID + GIS for live (any Google user).",
        };
      }

      if (!fetchFn) return { ok: false, error: "no fetch" };

      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
      );
      url.searchParams.set("timeMin", timeMin.toISOString());
      url.searchParams.set("timeMax", timeMax.toISOString());
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      url.searchParams.set("maxResults", "40");

      const res = await fetchFn(url.toString(), {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (!res.ok) {
        return {
          ok: false,
          error: `calendar_api_${res.status}`,
          needAuth: res.status === 401,
        };
      }
      const data = await res.json();
      return {
        ok: true,
        mock: false,
        general: true,
        calendarId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        events: (data.items || []).map(normalizeEvent),
      };
    },

    formatEvents(result) {
      if (!result?.ok) {
        return result?.needAuth
          ? "Google account not connected. After the plugin is ready, say “connect google calendar” (works for any Google user)."
          : `Calendar error: ${result?.error || "unknown"}`;
      }
      const lines = [
        result.mock
          ? "Upcoming (mock — general plugin; live with Client ID):"
          : "Upcoming on your Google Calendar:",
        `Window: ${String(result.timeMin).slice(0, 10)} → ${String(result.timeMax).slice(0, 10)}`,
        "",
      ];
      if (!result.events?.length) lines.push("No events in this window.");
      else {
        for (const e of result.events) {
          lines.push(
            `• ${e.when} — ${e.summary}${e.location ? ` @ ${e.location}` : ""}`
          );
        }
      }
      lines.push(
        "",
        "_Same OAuth + Calendar API plugin for every Google user — not tied to one account._"
      );
      return lines.join("\n");
    },
  };
}

function normalizeEvent(e) {
  const start = e.start?.dateTime || e.start?.date || "";
  const when = start.includes("T")
    ? new Date(start).toLocaleString()
    : start || "(time TBA)";
  return {
    id: e.id,
    summary: e.summary || "(no title)",
    when,
    location: e.location || "",
  };
}

function mockEvents(from, days) {
  const a = new Date(from.getTime() + 3600_000 * 5);
  const b = new Date(from.getTime() + 86400_000 + 3600_000 * 10);
  const out = [
    {
      id: "mock-1",
      summary: "Focus block (sample)",
      when: a.toLocaleString(),
      location: "",
    },
  ];
  if (days > 1) {
    out.push({
      id: "mock-2",
      summary: "Team sync (sample)",
      when: b.toLocaleString(),
      location: "Meet",
    });
  }
  return out;
}
