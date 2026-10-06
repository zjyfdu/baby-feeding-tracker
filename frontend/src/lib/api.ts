export type EventKind = 'feeding' | 'diaper'

export interface CareEvent {
  id: number
  kind: EventKind
  /** Start time of the event. */
  event_at: string
  /** Finish time, only set when a duration is known. */
  ended_at: string | null
  type: string
  amount: number | null
  duration_min: number | null
  status: 'done' | 'running'
  note: string | null
  created_at: string
}

export interface CareOptions {
  types: string[]
  amounts: number[]
  diaperStates: string[]
}

/** One row per calendar day (and kind) that has records. */
export interface DayCount {
  day: string
  kind: EventKind
  count: number
}

export interface Bootstrap {
  options: CareOptions
  /** Records of the recent window only; older days are fetched on demand. */
  events: CareEvent[]
  dayCounts: DayCount[]
  /** Newest start time per kind, for "距上次" beyond the loaded window. */
  latest: Partial<Record<EventKind, string | null>>
}

const BASE = '/api'

/** Timezone of the device, so day boundaries match what the user sees. */
export const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'

/** Read the whole app state in one round trip (used for the first paint). */
export const fetchBootstrap = () =>
  req<Bootstrap>(`${BASE}/bootstrap?days=14&tz=${encodeURIComponent(localTz())}`)

/** Records of one day, plus the last record before it so gaps stay correct. */
export const fetchDay = (day: string) =>
  req<CareEvent[]>(`${BASE}/events?day=${day}&tz=${encodeURIComponent(localTz())}`)

/** Download link for the full history backup. */
export const exportUrl = () => `${BASE}/export?tz=${encodeURIComponent(localTz())}`

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  if (!r.ok) {
    let msg = '操作失败'
    try {
      const j = await r.json()
      if (j && j.error) msg = j.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  if (r.status === 204) return undefined as T
  return (await r.json()) as T
}

export const api = {
  listEvents: () => req<CareEvent[]>(`${BASE}/events?limit=500`),
  addEvent: (p: {
    kind: EventKind
    event_at: string
    type: string
    amount: number | null
    duration_min?: number | null
    note?: string | null
  }) =>
    req<CareEvent>(`${BASE}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }),
  updateEvent: (
    id: number,
    patch: {
      event_at?: string
      type?: string
      amount?: number | null
      duration_min?: number | null
    }
  ) =>
    req<CareEvent>(`${BASE}/events/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  deleteEvent: (id: number) => req<void>(`${BASE}/events/${id}`, { method: 'DELETE' }),
  getOptions: () => req<CareOptions>(`${BASE}/options`),
  saveOptions: (o: CareOptions) =>
    req<CareOptions>(`${BASE}/options`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(o),
    }),
}
