// One-off converter for the legacy app's CSV export.
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const input = process.argv[2]
const outDir = process.argv[3] ?? 'dev/import'

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (ch !== '\r') {
      cell += ch
    }
  }
  if (cell.length || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

const raw = fs.readFileSync(input, 'utf8').replace(/^\ufeff/, '')
const rows = parseCsv(raw)
const header = rows.shift()
if (header.join(',') !== '日期,时间,类别,内容,毫升,分钟,结束时间,备注') {
  throw new Error(`unexpected header: ${header.join(',')}`)
}

const pad = (value) => String(value).padStart(2, '0')
const events = []
const skipped = []
const counts = new Map()
let amounts = 0
let durations = 0
let notes = 0

for (const row of rows) {
  if (!row.length || row.every((cell) => cell.trim() === '')) continue
  const [date, time, label, type, amountRaw, durationRaw, , noteRaw] = row
  const dateMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date.trim())
  const timeMatch = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(time.trim())
  if (!dateMatch || !timeMatch) {
    skipped.push(row)
    continue
  }
  const day = `${dateMatch[1]}-${pad(dateMatch[2])}-${pad(dateMatch[3])}`
  const isoLocal = `${day}T${pad(timeMatch[1])}:${timeMatch[2]}:${timeMatch[3]}+08:00`
  const eventAt = new Date(isoLocal)
  if (Number.isNaN(eventAt.getTime())) {
    skipped.push(row)
    continue
  }
  const kind = label.trim() === '吃奶' ? 'feeding' : label.trim() === '尿不湿' ? 'diaper' : null
  if (!kind) {
    skipped.push(row)
    continue
  }
  const amount = amountRaw.trim() === '' ? null : Number(amountRaw)
  const duration = durationRaw.trim() === '' ? null : Number(durationRaw)
  const note = noteRaw?.trim() ? noteRaw.trim() : null
  if (amount != null) amounts++
  if (duration != null) durations++
  if (note) notes++
  const endedAt =
    duration == null ? null : new Date(eventAt.getTime() + duration * 60000).toISOString()
  events.push({
    id: randomUUID(),
    kind,
    day,
    event_at: eventAt.toISOString(),
    ended_at: endedAt,
    type: type.trim(),
    amount: amount != null && Number.isInteger(amount) ? amount : null,
    duration_min: duration != null && Number.isInteger(duration) ? duration : null,
    status: 'done',
    note,
    created_at: new Date().toISOString(),
  })
  const key = `${day}:${kind}`
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

events.sort((a, b) => (a.event_at < b.event_at ? 1 : -1))

fs.mkdirSync(outDir, { recursive: true })

const text = (column, value) => ({ column, type: 'text', value })
const int = (column, value) => ({ column, type: 'integer', value: String(value) })
const nil = (column) => ({ column, type: 'null' })

// Rows without optional values can omit those cells entirely; only the 7
// required columns are sent for the bulk of the history.
const plain = events.filter(
  (e) => e.ended_at == null && e.amount == null && e.duration_min == null && !e.note
)
const special = events.filter((e) => !plain.includes(e))

const plainRow = (e) => ({
  cells: [
    text('id', e.id),
    text('kind', e.kind),
    text('day', e.day),
    text('event_at', e.event_at),
    text('type', e.type),
    text('status', e.status),
    text('created_at', e.created_at),
  ],
})

const specialRow = (e) => ({
  cells: [
    text('id', e.id),
    text('kind', e.kind),
    text('day', e.day),
    text('event_at', e.event_at),
    e.ended_at ? text('ended_at', e.ended_at) : nil('ended_at'),
    text('type', e.type),
    e.amount != null ? int('amount', e.amount) : nil('amount'),
    e.duration_min != null ? int('duration_min', e.duration_min) : nil('duration_min'),
    text('status', e.status),
    e.note ? text('note', e.note) : nil('note'),
    text('created_at', e.created_at),
  ],
})

const batches = []
for (let i = 0; i < plain.length; i += 100) {
  batches.push(plain.slice(i, i + 100).map(plainRow))
}
if (special.length) batches.push(special.map(specialRow))

const dayRows = [...counts.entries()].map(([key, count]) => {
  const [day, kind] = key.split(':')
  return { id: key, day, kind, count }
})
const dayBatches = []
for (let i = 0; i < dayRows.length; i += 100) {
  dayBatches.push(
    dayRows.slice(i, i + 100).map((d) => ({
      cells: [
        text('id', d.id),
        text('day', d.day),
        text('kind', d.kind),
        int('count', d.count),
      ],
    }))
  )
}

const write = (name, value) => {
  const target = path.join(outDir, name)
  fs.writeFileSync(target, JSON.stringify(value))
  return `${target} (${fs.statSync(target).size} bytes)`
}

const files = []
batches.forEach((batch, i) => files.push(write(`events-${i + 1}.json`, batch)))
dayBatches.forEach((batch, i) => files.push(write(`days-${i + 1}.json`, batch)))

console.log(
  JSON.stringify(
    {
      rows: rows.length,
      events: events.length,
      skipped: skipped.length,
      amounts,
      durations,
      notes,
      plain: plain.length,
      special: special.length,
      dayGroups: dayRows.length,
      range: events.length ? [events.at(-1).event_at, events[0].event_at] : [],
      eventFiles: files.filter((f) => f.includes('events-')),
      dayFiles: files.filter((f) => f.includes('days-')),
    },
    null,
    2
  )
)
