import assert from "node:assert/strict";
import { test } from "node:test";
import { localTime, parseWeatherQuery, shapeWeather, type OpenMeteo } from "../src/weather.ts";

function forecast(): OpenMeteo {
  const days = ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"];
  const time: string[] = [];
  for (const d of days) for (let h = 0; h < 24; h++) time.push(`${d}T${String(h).padStart(2, "0")}:00`);
  return {
    current: { time: "2026-11-20T15:45", temperature_2m: 8.14, apparent_temperature: 5.26 },
    hourly: {
      time,
      temperature_2m: time.map((_, i) => i / 10),
      weather_code: time.map((_, i) => (i % 2 ? 61 : 3)),
      precipitation_probability: time.map((_, i) => (i % 3 ? i % 100 : null)),
    },
    daily: {
      time: days,
      weather_code: days.map(() => 3),
      temperature_2m_max: days.map(() => 9.06),
      temperature_2m_min: days.map(() => 4.04),
      sunrise: days.map((d) => `${d}T08:20`),
      sunset: days.map((d) => `${d}T16:50`),
      precipitation_probability_max: days.map(() => 40),
    },
  };
}

test("dashboard weather: current hour onward, night from sunrise/sunset, today plus five days", () => {
  const w = shapeWeather(forecast(), "2026-11-20T15:47:12")!;
  assert.equal(w.temp, 8.1);
  assert.equal(w.feels, 5.3);
  assert.equal(w.hours.length, 13);
  assert.deepEqual(w.hours[0], { hour: 15, temp: 1.5, code: 61, night: 0 }); // no probability at 15:00
  assert.equal(w.hours[1].rain, 16);
  assert.equal(w.code, 61);
  assert.equal(w.night, 0);
  assert.equal(w.hours[1].night, 0); // 16:00 is before the 16:50 sunset
  assert.equal(w.hours[2].night, 1); // 17:00
  assert.equal(w.hours[12].hour, 3); // crosses midnight
  assert.equal("rain" in w.hours[3], false); // 18:00 has no probability
  assert.equal(w.days.length, 6);
  assert.deepEqual(w.days[0], { date: "2026-11-20", hi: 9.1, lo: 4, code: 3, rain: 40 });
});

test("dashboard weather is null when the forecast doesn't cover the window", () => {
  assert.equal(shapeWeather(forecast(), "2026-11-25T12:00:00"), null); // fewer than six days left
  assert.equal(shapeWeather(forecast(), "2026-12-01T12:00:00"), null);
});

test("weather query defaults to Bruges and rejects bad input", () => {
  assert.deepEqual(parseWeatherQuery(new URLSearchParams("")), { lat: 51.21, lon: 3.22, tz: "Europe/Brussels" });
  assert.deepEqual(parseWeatherQuery(new URLSearchParams("lat=999&lon=x&tz=Mars/Base")), { lat: 51.21, lon: 3.22, tz: "Europe/Brussels" });
  assert.equal(localTime(Date.parse("2026-07-01T12:00:05Z"), "Europe/Brussels"), "2026-07-01T14:00:05");
});
