// When the news refreshes: at 6:07, 12:07, 16:07 and 20:07 Brussels time.
// Cron triggers run in UTC, so wrangler.jsonc fires at minute 7 of both the summer (CEST)
// and winter (CET) UTC hour for each of these, and scheduled() skips the one that isn't.

export const REFRESH_HOURS = [6, 12, 16, 20];
export const REFRESH_MINUTE = 7;
export const TIME_ZONE = "Europe/Brussels";

const HOUR = 3_600_000;
const hourFormat = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "numeric", hourCycle: "h23" });

/** The hour on the clock in Brussels at this moment. */
export function brusselsHour(t: number): number {
  return Number(hourFormat.format(new Date(t)));
}

/** Whether a cron firing at this time is one of the refresh times (and not its DST twin). */
export function isRefreshTime(t: number): boolean {
  return REFRESH_HOURS.includes(brusselsHour(t));
}

/** The next refresh after `now`, plus a few minutes for the run to finish. */
export function nextRefresh(now: number): number {
  const d = new Date(now);
  d.setUTCMinutes(REFRESH_MINUTE, 0, 0);
  let t = d.getTime();
  if (t <= now) t += HOUR;
  while (!isRefreshTime(t)) t += HOUR;
  return t + 3 * 60_000; // allow the run a few minutes to finish
}
