/**
 * Capability intent from a single user prompt (nothing else required).
 * Pure — general patterns, not user-specific.
 */

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   provider: string,
 *   scopes: string[],
 *   general: true,
 *   pluginId: string,
 *   requiresAuth: boolean,
 * }} CapabilityNeed
 */

const CAPABILITIES = [
  {
    id: "weather.read",
    title: "Weather (public forecast)",
    provider: "open-meteo",
    scopes: [],
    general: true,
    pluginId: "weather",
    requiresAuth: false,
    patterns: [
      /\bweather\b/i,
      /\bforecast\b/i,
      /\btemperature\b/i,
      /\bhow\s+hot\b/i,
      /\bhow\s+cold\b/i,
      /\brain(ing)?\b.*\b(today|tomorrow|week)\b/i,
      /\b(today|tomorrow|this week)\b.*\brain/i,
    ],
  },
  {
    id: "google-calendar.read",
    title: "Google Calendar (read)",
    provider: "google",
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    general: true,
    pluginId: "google-calendar",
    requiresAuth: true,
    patterns: [
      /\bgoogle\s+calendar\b/i,
      /\bmy\s+calendar\b/i,
      /\bcalendar\b.*\b(next|today|tomorrow|this week|few days|upcoming)\b/i,
      /\b(next|upcoming|few)\s+days?\b.*\bcalendar\b/i,
      /\banything on my (google )?calendar\b/i,
      /\bwhat('s| is) on my calendar\b/i,
      /\bschedule\b.*\b(next|this)\s+(week|few days)\b/i,
    ],
  },
];

/**
 * From user text alone, detect capability needs.
 * @param {string} userText
 * @returns {CapabilityNeed[]}
 */
export function detectCapabilityNeeds(userText) {
  const t = String(userText || "").trim();
  if (!t) return [];
  const out = [];
  for (const c of CAPABILITIES) {
    if (c.patterns.some((re) => re.test(t))) {
      out.push({
        id: c.id,
        title: c.title,
        provider: c.provider,
        scopes: [...(c.scopes || [])],
        general: true,
        pluginId: c.pluginId,
        requiresAuth: !!c.requiresAuth,
      });
    }
  }
  return out;
}

/** Extract a place name for weather-like prompts (pure, general). */
export function extractPlace(userText) {
  const t = String(userText || "").trim();
  const m =
    t.match(
      /\b(?:in|for|at|near)\s+([A-Za-z][A-Za-z\s.'-]{1,48}?)(?:\?|$|,|\.|!)/i
    ) ||
    t.match(
      /\bweather\s+(?:in|for|at)?\s*([A-Za-z][A-Za-z\s.'-]{1,48}?)(?:\?|$)/i
    );
  if (m?.[1]) {
    return m[1]
      .replace(
        /\b(today|tomorrow|tonight|please|now|right|currently|this week|next week)\b/gi,
        ""
      )
      .replace(/\s+/g, " ")
      .trim();
  }
  return "London"; // geo-free default — still general multi-place plugin
}

export function isCalendarQuery(userText) {
  return detectCapabilityNeeds(userText).some(
    (n) => n.pluginId === "google-calendar"
  );
}

export function isWeatherQuery(userText) {
  return detectCapabilityNeeds(userText).some((n) => n.pluginId === "weather");
}

export function catalogEntry(pluginId) {
  return CAPABILITIES.find((c) => c.pluginId === pluginId) || null;
}

export { CAPABILITIES };
