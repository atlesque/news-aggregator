// Weather for the keyed dashboard endpoint. The device used to call Open-Meteo itself and parse
// about 10 KB of forecast; here the Worker fetches it once per location every few minutes and hands
// the device only what an e-ink weather column shows. Shaping is pure, so it's easy to test.

import { USER_AGENT } from "./sources/types.ts";

/** How long a location's raw forecast is reused, at the edge and in the isolate. */
const WEATHER_TTL = 600;
/** The current hour plus the next twelve. */
export const DASHBOARD_HOURS = 13;
/** Today plus the next five days. */
export const DASHBOARD_DAYS = 6;

export interface WeatherQuery {
  lat: number;
  lon: number;
  tz: string;
}

/** The subset of Open-Meteo's forecast response the dashboard uses. */
export interface OpenMeteo {
  current: { time: string; temperature_2m: number; apparent_temperature?: number | null };
  hourly: { time: string[]; temperature_2m: number[]; weather_code: number[]; precipitation_probability?: (number | null)[] };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    sunrise: string[];
    sunset: string[];
    precipitation_probability_max?: (number | null)[];
  };
}

export interface DashboardHour {
  hour: number;
  temp: number;
  code: number;
  /** Chance of precipitation in %; left out when Open-Meteo has none. */
  rain?: number;
  night: 0 | 1;
}

export interface DashboardDay {
  date: string;
  hi: number;
  lo: number;
  code: number;
  rain?: number;
}

export interface DashboardWeather {
  temp: number;
  feels?: number;
  code: number;
  night: 0 | 1;
  hours: DashboardHour[];
  days: DashboardDay[];
}

export function parseWeatherQuery(params: URLSearchParams): WeatherQuery {
  const num = (k: string, def: number, min: number, max: number) => {
    const v = Number.parseFloat(params.get(k) ?? "");
    return Number.isFinite(v) && v >= min && v <= max ? v : def;
  };
  let tz = params.get("tz") ?? "Europe/Brussels";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    tz = "Europe/Brussels";
  }
  // Two decimals (about 1 km) is finer than the forecast grid, and keeps the cache small.
  const round = (v: number) => Math.round(v * 100) / 100;
  return { lat: round(num("lat", 51.2093, -90, 90)), lon: round(num("lon", 3.2247, -180, 180)), tz };
}

/** Local wall-clock time in `tz` as "YYYY-MM-DDTHH:MM:SS", the format Open-Meteo uses. */
export function localTime(t: number, tz: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(t))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

const one = (v: number) => Math.round(v * 10) / 10;
const percent = (v: number | null | undefined) => (typeof v === "number" && v >= 0 && v <= 100 ? Math.round(v) : undefined);

/**
 * The weather column from a raw forecast, as seen at local time `now` ("YYYY-MM-DDTHH:MM[:SS]").
 * Returns null when the forecast doesn't cover the next twelve hours and five days, so the device
 * keeps what it showed last rather than drawing a half-empty column.
 */
export function shapeWeather(raw: OpenMeteo, now: string): DashboardWeather | null {
  const { hourly, daily, current } = raw;
  const dayIdx = daily.time.indexOf(now.slice(0, 10));
  if (dayIdx < 0 || daily.time.length - dayIdx < DASHBOARD_DAYS) return null;
  const hourIdx = hourly.time.findIndex((t) => t.slice(0, 13) === now.slice(0, 13));
  if (hourIdx < 0 || hourly.time.length - hourIdx < DASHBOARD_HOURS) return null;

  // Night is before that day's sunrise or from its sunset. The timestamps are local and sort as strings.
  const sun = new Map(daily.time.map((d, i) => [d, [daily.sunrise[i], daily.sunset[i]] as const]));
  const isNight = (t: string): 0 | 1 => {
    const s = sun.get(t.slice(0, 10));
    const minute = t.slice(0, 16);
    return s && (minute < s[0].slice(0, 16) || minute >= s[1].slice(0, 16)) ? 1 : 0;
  };

  const hours: DashboardHour[] = [];
  for (let i = hourIdx; i < hourIdx + DASHBOARD_HOURS; i++) {
    const h: DashboardHour = {
      hour: Number(hourly.time[i].slice(11, 13)),
      temp: one(hourly.temperature_2m[i]),
      code: hourly.weather_code[i],
      night: isNight(hourly.time[i]),
    };
    const rain = percent(hourly.precipitation_probability?.[i]);
    if (rain !== undefined) h.rain = rain;
    hours.push(h);
  }

  const days: DashboardDay[] = [];
  for (let i = dayIdx; i < dayIdx + DASHBOARD_DAYS; i++) {
    const d: DashboardDay = {
      date: daily.time[i],
      hi: one(daily.temperature_2m_max[i]),
      lo: one(daily.temperature_2m_min[i]),
      code: daily.weather_code[i],
    };
    const rain = percent(daily.precipitation_probability_max?.[i]);
    if (rain !== undefined) d.rain = rain;
    days.push(d);
  }

  const out: DashboardWeather = {
    temp: one(current.temperature_2m),
    // The hourly code: Open-Meteo's "current" code is a 15-minute model value that flickers.
    code: hours[0].code,
    night: isNight(now),
    hours,
    days,
  };
  if (typeof current.apparent_temperature === "number") out.feels = one(current.apparent_temperature);
  return out;
}

let memo = new Map<string, { raw: OpenMeteo; at: number }>();

/** The raw forecast for a location, from the isolate, then the edge cache, then Open-Meteo. */
export async function rawForecast(q: WeatherQuery, ctx: ExecutionContext): Promise<OpenMeteo | null> {
  const key = `${q.lat},${q.lon},${q.tz}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < WEATHER_TTL * 1000) return hit.raw;

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${q.lat}&longitude=${q.lon}` +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max" +
    "&hourly=weather_code,temperature_2m,precipitation_probability" +
    "&current=temperature_2m,apparent_temperature" +
    `&temperature_unit=celsius&timezone=${encodeURIComponent(q.tz)}&forecast_days=7`;
  const cacheKey = new Request(url);
  let res = await caches.default.match(cacheKey);
  if (!res) {
    const live = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(8_000) }).catch(() => null);
    if (!live?.ok) return null;
    const body = await live.text();
    res = new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${WEATHER_TTL}` } });
    ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
  }
  try {
    const raw = (await res.json()) as OpenMeteo;
    if (!raw?.hourly?.time || !raw?.daily?.time || !raw?.current) return null;
    if (memo.size > 20) memo = new Map();
    memo.set(key, { raw, at: Date.now() });
    return raw;
  } catch {
    return null;
  }
}
