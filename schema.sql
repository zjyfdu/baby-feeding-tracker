-- Event-sourced care log for the baby tracker.
CREATE TABLE app.events (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  day text NOT NULL,
  event_at timestamptz NOT NULL,
  ended_at timestamptz,
  type text NOT NULL,
  amount integer,
  duration_min integer,
  status text NOT NULL,
  note text,
  created_at timestamptz NOT NULL
);
CREATE INDEX events_kind_event_at_idx ON app.events (kind, event_at);
CREATE INDEX events_event_at_idx ON app.events (event_at);
CREATE INDEX events_day_kind_idx ON app.events (day, kind);

-- One row per (local day, kind) so the date tabs never scan the full history.
CREATE TABLE app.event_days (
  id text PRIMARY KEY,
  day text NOT NULL,
  kind text NOT NULL,
  count integer NOT NULL
);

-- Customizable chip presets (feeding types and amounts).
CREATE TABLE app.feed_options (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);
