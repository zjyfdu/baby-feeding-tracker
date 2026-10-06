import pg from 'pg'
import { env } from './env.js'
import { logger } from './logger.js'

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
})

/**
 * Create tables (idempotent) and seed default options on first run.
 */
export async function initSchema() {
  // Migrate the original feeding-only table into the generic care-event table
  // (renaming keeps every existing row intact).
  await pool.query('ALTER TABLE IF EXISTS feedings RENAME TO events')

  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id BIGSERIAL PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'feeding',
      event_at TIMESTAMPTZ NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER,
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'events' AND column_name = 'feed_at'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'events' AND column_name = 'event_at'
      ) THEN
        ALTER TABLE events RENAME COLUMN feed_at TO event_at;
      END IF;
    END $$;
  `)
  await pool.query(
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'feeding'`
  )
  // Breastfeeding is measured in minutes: event_at = start, ended_at = finish.
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS duration_min INTEGER`)
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ`)
  await pool.query(
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'done'`
  )

  // Date tabs and range scans always read newest-first per kind.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_events_kind_event_at ON events (kind, event_at DESC)`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_events_event_at ON events (event_at DESC)`
  )

  await pool.query(`
    CREATE TABLE IF NOT EXISTS feed_options (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `)
  await pool.query(
    `INSERT INTO feed_options (key, value) VALUES ('types', $1::jsonb)
     ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify(['母乳', '奶粉'])]
  )
  await pool.query(
    `INSERT INTO feed_options (key, value) VALUES ('amounts', $1::jsonb)
     ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify([30, 60, 90, 120, 150, 180])]
  )
  await pool.query(
    `INSERT INTO feed_options (key, value) VALUES ('diaperStates', $1::jsonb)
     ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify(['💩多', '💩少', '无💩'])]
  )

  // One-off upgrade: replace the earlier diaper states with the current ones
  await pool.query(
    `UPDATE feed_options
     SET value = $1::jsonb, updated_at = now()
     WHERE key = 'diaperStates' AND value::text LIKE '%尿尿%'`,
    [JSON.stringify(['💩多', '💩少', '无💩'])]
  )
}

let readyPromise: Promise<void> | null = null

/**
 * Run initSchema in the background until it succeeds. The sandbox (and its
 * database container) can be asleep when this process boots, so requests must
 * wait for the schema instead of failing permanently.
 */
const initWithRetry = async (attempts = 60, delayMs = 2000) => {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await initSchema()
      logger.info('Database ready')
      return
    } catch (error) {
      lastError = error
      logger.warn({ err: error, attempt }, 'Database not ready yet, retrying')
      if (attempt < attempts) await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw lastError
}

/** Shared, memoized readiness promise; resets on failure so later requests retry. */
export function ensureReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = initWithRetry().catch((error) => {
      readyPromise = null
      throw error
    })
  }
  return readyPromise
}

export default pool
