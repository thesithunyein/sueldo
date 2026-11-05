const ART_OFFSET_MS = -3 * 60 * 60 * 1000

/** Argentina has used a fixed UTC-3 offset since 2009, so no tz database is needed. */
export const artDate = (d: Date = new Date()): string =>
  new Date(d.getTime() + ART_OFFSET_MS).toISOString().slice(0, 10)

export const artHour = (d: Date = new Date()): number =>
  new Date(d.getTime() + ART_OFFSET_MS).getUTCHours()

export const artWeekday = (d: Date = new Date()): number =>
  new Date(d.getTime() + ART_OFFSET_MS).getUTCDay()

const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Monday..Sunday containing `ref`. */
export const weekRange = (ref: Date = new Date()): { start: string; end: string } => {
  const today = artDate(ref)
  const dow = new Date(`${today}T00:00:00.000Z`).getUTCDay()
  const backToMonday = dow === 0 ? 6 : dow - 1
  const start = addDays(today, -backToMonday)
  return { start, end: addDays(start, 6) }
}

export const previousWeeks = (weeks: number, ref: Date = new Date()): { start: string; end: string } => {
  const current = weekRange(ref)
  return { start: addDays(current.start, -7 * weeks), end: addDays(current.start, -1) }
}

export const monthOf = (date: string): string => date.slice(0, 7)

export const periodLabel = (start: string, end: string): string => {
  const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
  return `${fmt(start)} al ${fmt(end)}`
}

export const isPaydayWindow = (d: Date = new Date()): boolean =>
  artWeekday(d) === 5 && artHour(d) >= 18
