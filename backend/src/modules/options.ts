import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { pool } from '../config/database.js'

export const optionsRouter: Router = Router()

export const DEFAULTS = {
  types: ['母乳', '奶粉'],
  amounts: [30, 60, 90, 120, 150, 180],
  diaperStates: ['💩多', '💩少', '无💩'],
}

const updateSchema = z.object({
  types: z.array(z.string()).default([]),
  amounts: z.array(z.number().int()).default([]),
  diaperStates: z.array(z.string()).default([]),
})

export async function readOptions() {
  const { rows } = await pool.query('SELECT key, value FROM feed_options')
  const map: Record<string, unknown> = {}
  for (const r of rows) map[r.key as string] = r.value
  return {
    types: Array.isArray(map.types) ? (map.types as string[]) : DEFAULTS.types,
    amounts: Array.isArray(map.amounts) ? (map.amounts as number[]) : DEFAULTS.amounts,
    diaperStates: Array.isArray(map.diaperStates)
      ? (map.diaperStates as string[])
      : DEFAULTS.diaperStates,
  }
}

optionsRouter.get('/', async (_req: Request, res: Response) => {
  res.json(await readOptions())
})

optionsRouter.put('/', async (req: Request, res: Response) => {
  const body = updateSchema.parse(req.body)
  const entries: Array<[string, unknown]> = [
    ['types', body.types],
    ['amounts', body.amounts],
    ['diaperStates', body.diaperStates],
  ]
  for (const [key, value] of entries) {
    await pool.query(
      `INSERT INTO feed_options (key, value, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)]
    )
  }
  res.json(await readOptions())
})
