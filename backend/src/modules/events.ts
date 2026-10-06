import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { pool } from '../config/database.js'

export const eventsRouter: Router = Router()

export const EVENT_KINDS = ['feeding', 'diaper'] as const
export const EVENT_STATUS = ['done', 'running'] as const

const COLUMNS = `id, kind, event_at, ended_at, type, amount, duration_min, status, note, created_at`

const createSchema = z.object({
  kind: z.enum(EVENT_KINDS).default('feeding'),
  event_at: z.string().min(1),
  type: z.string().min(1),
  amount: z.number().int().nullable().optional(),
  duration_min: z.number().int().nullable().optional(),
  status: z.enum(EVENT_STATUS).default('done'),
  note: z.string().optional(),
})

const updateSchema = z.object({
  event_at: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  amount: z.number().int().nullable().optional(),
  duration_min: z.number().int().nullable().optional(),
  status: z.enum(EVENT_STATUS).optional(),
  note: z.string().optional(),
})

/** ended_at is always derived from the start time plus the duration. */
const syncEndedAt = (id: number) =>
  pool.query(
    `UPDATE events
     SET ended_at = CASE
       WHEN duration_min IS NULL THEN NULL
       ELSE event_at + (duration_min * INTERVAL '1 minute')
     END
     WHERE id = $1`,
    [id]
  )

const endedAtFrom = (startIso: string, durationMin: number | null | undefined) =>
  durationMin == null
    ? null
    : new Date(new Date(startIso).getTime() + durationMin * 60000).toISOString()

const clientTz = (req: Request) =>
  typeof req.query.tz === 'string' && req.query.tz ? req.query.tz : 'Asia/Shanghai'

/** Shared read used by the list route and the first-paint bundle. */
export async function listEvents(limit = 500, kind: string | null = null) {
  const { rows } = kind
    ? await pool.query(
        `SELECT ${COLUMNS}
         FROM events
         WHERE kind = $1
         ORDER BY event_at DESC
         LIMIT $2`,
        [kind, limit]
      )
    : await pool.query(
        `SELECT ${COLUMNS}
         FROM events
         ORDER BY event_at DESC
         LIMIT $1`,
        [limit]
      )
  return rows
}

/**
 * Records from the last N days only. Keeping the first paint proportional to a
 * few days instead of the whole history means it never slows down as the data
 * grows.
 */
export async function listRecentWindow(days: number) {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS}
     FROM events
     WHERE event_at >= now() - make_interval(days => $1::int)
     ORDER BY event_at DESC
     LIMIT 500`,
    [days]
  )
  return rows
}

/** Newest record timestamp per kind, used for "距上次" even outside the window. */
export async function latestTimes(): Promise<Record<string, string | null>> {
  const { rows } = await pool.query(
    `SELECT kind, MAX(event_at) AS latest FROM events GROUP BY kind`
  )
  const map: Record<string, string | null> = {}
  for (const k of EVENT_KINDS) map[k] = null
  for (const r of rows) map[r.kind as string] = r.latest?.toISOString?.() ?? null
  return map
}

/** Records of one local calendar day, plus the last one before it (for gaps). */
export async function listDay(day: string, tz: string) {
  const { rows: bounds } = await pool.query(
    `SELECT ($1::date AT TIME ZONE $2) AS lo, (($1::date + 1) AT TIME ZONE $2) AS hi`,
    [day, tz]
  )
  const { lo, hi } = bounds[0]
  const [dayRows, prevRow] = await Promise.all([
    pool.query(
      `SELECT ${COLUMNS} FROM events
       WHERE event_at >= $1 AND event_at < $2
       ORDER BY event_at DESC`,
      [lo, hi]
    ),
    pool.query(
      `SELECT ${COLUMNS} FROM events
       WHERE event_at < $1
       ORDER BY event_at DESC
       LIMIT 1`,
      [lo]
    ),
  ])
  return [...dayRows.rows, ...prevRow.rows]
}

/** Records-per-day summary; enough to build the date tabs without loading rows. */
export async function listDayCounts(tz: string) {
  const { rows } = await pool.query(
    `SELECT to_char((event_at AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day,
            kind,
            count(*)::int AS count
     FROM events
     GROUP BY 1, 2
     ORDER BY 1 DESC`,
    [tz]
  )
  return rows.map((r) => ({ day: r.day as string, kind: r.kind as string, count: r.count as number }))
}

eventsRouter.get('/days', async (req: Request, res: Response) => {
  res.json(await listDayCounts(clientTz(req)))
})

eventsRouter.get('/', async (req: Request, res: Response) => {
  if (typeof req.query.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.day)) {
    res.json(await listDay(req.query.day, clientTz(req)))
    return
  }

  const limit = Math.min(Number(req.query.limit) || 200, 1000)
  const kind = typeof req.query.kind === 'string' ? req.query.kind : null
  res.json(await listEvents(limit, kind))
})

eventsRouter.post('/', async (req: Request, res: Response) => {
  const body = createSchema.parse(req.body)

  // Only one feeding timer can run at a time.
  if (body.status === 'running') {
    await pool.query(`DELETE FROM events WHERE status = 'running'`)
  }

  const { rows } = await pool.query(
    `INSERT INTO events (kind, event_at, ended_at, type, amount, duration_min, status, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${COLUMNS}`,
    [
      body.kind,
      body.event_at,
      endedAtFrom(body.event_at, body.duration_min),
      body.type,
      body.amount ?? null,
      body.duration_min ?? null,
      body.status,
      body.note ?? null,
    ]
  )
  res.status(201).json(rows[0])
})

eventsRouter.patch('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid id' })
    return
  }

  const body = updateSchema.parse(req.body)
  const sets: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (body.event_at !== undefined) {
    sets.push(`event_at = $${idx++}`)
    values.push(body.event_at)
  }
  if (body.type !== undefined) {
    sets.push(`type = $${idx++}`)
    values.push(body.type)
  }
  if (body.amount !== undefined) {
    sets.push(`amount = $${idx++}`)
    values.push(body.amount)
  }
  if (body.duration_min !== undefined) {
    sets.push(`duration_min = $${idx++}`)
    values.push(body.duration_min)
  }
  if (body.status !== undefined) {
    sets.push(`status = $${idx++}`)
    values.push(body.status)
  }
  if (body.note !== undefined) {
    sets.push(`note = $${idx++}`)
    values.push(body.note)
  }

  if (sets.length === 0) {
    res.status(400).json({ error: 'no fields to update' })
    return
  }

  values.push(id)
  const { rows } = await pool.query(
    `UPDATE events SET ${sets.join(', ')}
     WHERE id = $${idx}
     RETURNING ${COLUMNS}`,
    values
  )

  if (rows.length === 0) {
    res.status(404).json({ error: 'record not found' })
    return
  }

  if (body.event_at !== undefined || body.duration_min !== undefined) {
    await syncEndedAt(id)
    const refreshed = await pool.query(`SELECT ${COLUMNS} FROM events WHERE id = $1`, [id])
    res.json(refreshed.rows[0])
    return
  }

  res.json(rows[0])
})

eventsRouter.delete('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid id' })
    return
  }
  await pool.query('DELETE FROM events WHERE id = $1', [id])
  res.status(204).end()
})
