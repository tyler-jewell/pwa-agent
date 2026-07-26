/**
 * Weather plugin — GENERAL, zero human auth.
 * Open-Meteo geocoding + forecast (no API key). Works for any place.
 */
import { extractPlace } from "./intent.js";

export const WEATHER_PLUGIN_ID = "weather";

/**
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
export function createWeatherPlugin({ fetchImpl = null } = {}) {
  const fetchFn =
    fetchImpl ||
    (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);

  return {
    id: WEATHER_PLUGIN_ID,
    title: "Weather (Open-Meteo)",
    general: true,
    requiresAuth: false,
    provider: "open-meteo",
    scopes: [],

    async isAuthed() {
      return true; // no auth ever
    },

    /**
     * Answer from user text alone (place extracted generally).
     */
    async handleQuery(userText) {
      const place = extractPlace(userText);
      return this.forecast({ place });
    },

    async forecast({ place = "London" } = {}) {
      if (!fetchFn) {
        return { ok: false, error: "no_fetch", place };
      }
      try {
        const geo = await geocode(place, fetchFn);
        if (!geo.ok) return geo;
        const url = new URL("https://api.open-meteo.com/v1/forecast");
        url.searchParams.set("latitude", String(geo.lat));
        url.searchParams.set("longitude", String(geo.lon));
        url.searchParams.set("current", "temperature_2m,weather_code,wind_speed_10m");
        url.searchParams.set("timezone", "auto");

        const res = await fetchFn(url.toString());
        if (!res.ok) {
          return {
            ok: false,
            error: `forecast_${res.status}`,
            place: geo.name,
          };
        }
        const data = await res.json();
        const cur = data.current || {};
        return {
          ok: true,
          general: true,
          place: geo.name,
          country: geo.country || "",
          latitude: geo.lat,
          longitude: geo.lon,
          temperatureC:
            cur.temperature_2m != null ? Number(cur.temperature_2m) : null,
          windKmh:
            cur.wind_speed_10m != null ? Number(cur.wind_speed_10m) : null,
          weatherCode: cur.weather_code != null ? Number(cur.weather_code) : null,
          conditions: codeToText(cur.weather_code),
          source: "open-meteo",
        };
      } catch (e) {
        return {
          ok: false,
          error: String(e?.message || e),
          place,
        };
      }
    },

    formatForecast(result) {
      if (!result?.ok) {
        return `Weather unavailable for ${result?.place || "that place"}: ${result?.error || "unknown"}.`;
      }
      const t =
        result.temperatureC != null
          ? `${result.temperatureC}°C`
          : "temperature n/a";
      const wind =
        result.windKmh != null ? `${result.windKmh} km/h wind` : "";
      const where = result.country
        ? `${result.place}, ${result.country}`
        : result.place;
      return [
        `Weather for **${where}** (general plugin — any place):`,
        `• Conditions: ${result.conditions}`,
        `• Temperature: ${t}`,
        wind ? `• Wind: ${wind}` : null,
        `• Source: ${result.source} (no API key / no user login)`,
      ]
        .filter(Boolean)
        .join("\n");
    },
  };
}

async function geocode(place, fetchFn) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", place);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const res = await fetchFn(url.toString());
  if (!res.ok) return { ok: false, error: `geocode_${res.status}`, place };
  const data = await res.json();
  const hit = data.results?.[0];
  if (!hit) return { ok: false, error: "place_not_found", place };
  return {
    ok: true,
    name: hit.name || place,
    country: hit.country || "",
    lat: hit.latitude,
    lon: hit.longitude,
  };
}

function codeToText(code) {
  const n = Number(code);
  if (!Number.isFinite(n)) return "unknown";
  if (n === 0) return "clear";
  if (n <= 3) return "partly cloudy";
  if (n <= 48) return "foggy";
  if (n <= 67) return "rainy";
  if (n <= 77) return "snowy";
  if (n <= 82) return "showers";
  if (n <= 99) return "thunderstorm";
  return `code ${n}`;
}
