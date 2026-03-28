import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { startOfISOWeek, addWeeks, getISOWeek, getISOWeekYear } from 'date-fns'

export const VIENNA_TZ = 'Europe/Vienna'
export const EPISODE_HOUR = 5 // 05:00 local Vienna time

export interface EpisodeWindow {
  number: number
  windowStart: Date // UTC
  windowEnd: Date   // UTC
  label: string     // e.g. "Episode 1 (2026-02-23 – 2026-03-02)"
}

/** Convert a Monday date to the episode boundary at 05:00 Vienna time (returns UTC) */
export function mondayAt5Vienna(monday: Date): Date {
  const zoned = toZonedTime(monday, VIENNA_TZ)
  zoned.setHours(EPISODE_HOUR, 0, 0, 0)
  return fromZonedTime(zoned, VIENNA_TZ)
}

/** The Monday 05:00 Vienna boundary for the ISO week containing a given UTC date */
export function episodeStartForDate(utcDate: Date): Date {
  const monday = startOfISOWeek(utcDate)
  return mondayAt5Vienna(monday)
}

/** Format a UTC date as Vienna local date string YYYY-MM-DD */
export function toViennaDateStr(utcDate: Date): string {
  return toZonedTime(utcDate, VIENNA_TZ).toISOString().slice(0, 10)
}

/**
 * Compute all episode windows from the oldest session forward,
 * up to (not including) the current open episode boundary.
 *
 * @param oldestSessionUtc - UTC timestamp of the oldest session's first message
 * @param cutoffUtc        - Upper bound (exclusive). Defaults to current Monday 05:00 Vienna.
 */
export function computeEpisodeWindows(
  oldestSessionUtc: Date,
  cutoffUtc?: Date,
): EpisodeWindow[] {
  const cutoff = cutoffUtc ?? currentEpisodeStart()
  const windows: EpisodeWindow[] = []

  let windowStart = episodeStartForDate(oldestSessionUtc)
  // If the oldest session falls before the 05:00 boundary on that Monday,
  // step back one week so we don't miss it
  if (oldestSessionUtc < windowStart) {
    windowStart = addWeeks(windowStart, -1)
  }

  let episodeNumber = 1
  while (windowStart < cutoff) {
    const windowEnd = addWeeks(windowStart, 1)
    const startStr = toViennaDateStr(windowStart)
    const endStr = toViennaDateStr(windowEnd)
    windows.push({
      number: episodeNumber,
      windowStart,
      windowEnd: windowEnd > cutoff ? cutoff : windowEnd,
      label: `Episode ${episodeNumber} (${startStr} – ${endStr})`,
    })
    windowStart = windowEnd
    episodeNumber++
  }

  return windows
}

/** The start of the current open episode (most recent Monday 05:00 Vienna, UTC) */
export function currentEpisodeStart(): Date {
  return episodeStartForDate(new Date())
}

/** ISO week label for a UTC date, e.g. "2026-W13" */
export function weekLabel(utcDate: Date): string {
  const week = getISOWeek(utcDate)
  const year = getISOWeekYear(utcDate)
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** Zero-padded episode folder name, e.g. 4 → "04" */
export function episodePad(n: number): string {
  return String(n).padStart(2, '0')
}
