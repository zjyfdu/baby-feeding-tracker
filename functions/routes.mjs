// Business routes for the baby care tracker. The platform adapter supplies the
// database client and the current visitor; nothing here trusts client identity.

const FEEDING = 'feeding'
const KIND_SET = new Set([FEEDING])
const STATUS_SET = new Set(['done', 'running'])
const DEFAULT_OPTIONS = {
  types: ['母乳', '奶粉'],
  amounts: [30, 60, 90, 120, 150, 180],
}
const COLUMNS = 'id,kind,event_at,ended_at,type,amount,duration_min,status,note,created_at'
const PAGE = 1000
const JSON_HEADERS = { 'cache-control': 'no-store' }
const json = (body, status = 200, headers = {}) =>
  Response.json(body, { status, headers: { ...JSON_HEADERS, ...headers } })

const isIso = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const isInt = (value) => Number.isInteger(value)
const cleanText = (value, max) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max

const pickTimeZone = (raw) => {
  if (typeof raw === 'string' && raw) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: raw })
      return raw
    } catch {
      /* fall through to the app default */
    }
  }
  return 'Asia/Shanghai'
}

const dayKey = (iso, tz) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso))
  const get = (type) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

const localParts = (iso, tz) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const get = (type) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')}`,
  }
}

export function application({ db, BackendError }) {
  const fail = (code, status) => {
    throw new BackendError(code, status)
  }
  const rows = (result) => {
    if (result?.error) fail('database_error', 503)
    return Array.isArray(result?.data) ? result.data : []
  }
  const row = (result) => {
    if (result?.error) fail('database_error', 503)
    return result?.data ?? null
  }

  async function body(request) {
    if (!request.headers.get('content-type')?.startsWith('application/json')) {
      fail('invalid_input', 400)
    }
    const reader = request.body?.getReader()
    if (!reader) fail('invalid_input', 400)
    let size = 0
    const chunks = []
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > 16384) {
          await reader.cancel()
          fail('payload_too_large', 413)
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
      fail('invalid_input', 400)
    }
  }

  async function readOptions() {
    const stored = rows(await db.from('feed_options').select('key,value'))
    const map = new Map(stored.map((r) => [r.key, r.value]))
    const types = map.get('types')
    const amounts = map.get('amounts')
    return {
      types:
        Array.isArray(types) && types.every((v) => typeof v === 'string')
          ? types
          : DEFAULT_OPTIONS.types,
      amounts:
        Array.isArray(amounts) && amounts.every((v) => Number.isInteger(v))
          ? amounts
          : DEFAULT_OPTIONS.amounts,
    }
  }

  async function saveOption(key, value) {
    const found = rows(await db.from('feed_options').select('key').eq('key', key).limit(1))
    const updated_at = new Date().toISOString()
    if (found.length) {
      rows(await db.from('feed_options').update({ value, updated_at }).eq('key', key))
      return
    }
    const inserted = await db.from('feed_options').insert({ key, value, updated_at })
    if (inserted?.error) {
      rows(await db.from('feed_options').update({ value, updated_at }).eq('key', key))
    }
  }

  async function recountDay(day, kind) {
    const ids = rows(
      await db.from('events').select('id').eq('day', day).eq('kind', kind).limit(PAGE)
    )
    const id = `${day}:${kind}`
    if (ids.length === 0) {
      const deleted = await db.from('event_days').delete().eq('id', id)
      if (deleted?.error) fail('database_error', 503)
      return
    }
    const found = rows(await db.from('event_days').select('id').eq('id', id).limit(1))
    if (found.length) {
      rows(await db.from('event_days').update({ count: ids.length }).eq('id', id))
      return
    }
    const inserted = await db.from('event_days').insert({
      id,
      day,
      kind,
      count: ids.length,
    })
    if (inserted?.error) {
      rows(await db.from('event_days').update({ count: ids.length }).eq('id', id))
    }
  }

  async function dayCounts() {
    const out = []
    for (let offset = 0; offset < 20000; offset += PAGE) {
      const page = rows(
        await db
          .from('event_days')
          .select('day,kind,count')
          .eq('kind', FEEDING)
          .order('day', { ascending: false })
          .range(offset, offset + PAGE - 1)
      )
      out.push(...page)
      if (page.length < PAGE) break
    }
    return out
  }

  async function recentEvents(days) {
    const since = new Date(Date.now() - days * 86400000).toISOString()
    return rows(
      await db
        .from('events')
        .select(COLUMNS)
        .eq('kind', FEEDING)
        .gte('event_at', since)
        .order('event_at', { ascending: false })
        .limit(500)
    )
  }

  async function latestTimes() {
    const result = {}
    for (const kind of KIND_SET) {
      const found = rows(
        await db
          .from('events')
          .select('event_at')
          .eq('kind', kind)
          .order('event_at', { ascending: false })
          .limit(1)
      )
      result[kind] = found[0]?.event_at ?? null
    }
    return result
  }

  async function listDay(day) {
    const dayRows = rows(
      await db
        .from('events')
        .select(COLUMNS)
        .eq('kind', FEEDING)
        .eq('day', day)
        .order('event_at', { ascending: false })
        .limit(500)
    )
    const previous = rows(
      await db
        .from('events')
        .select(COLUMNS)
        .eq('kind', FEEDING)
        .lt('day', day)
        .order('event_at', { ascending: false })
        .limit(1)
    )
    return [...dayRows, ...previous]
  }

  async function listEvents(limit) {
    return rows(
      await db
        .from('events')
        .select(COLUMNS)
        .eq('kind', FEEDING)
        .order('event_at', { ascending: false })
        .limit(limit)
    )
  }

  const endedAtFrom = (startIso, durationMin) =>
    durationMin == null
      ? null
      : new Date(new Date(startIso).getTime() + durationMin * 60000).toISOString()

  const validateCreate = (value) => {
    if (!value || typeof value !== 'object') fail('invalid_input', 400)
    const kind = value.kind ?? FEEDING
    if (!KIND_SET.has(kind)) fail('invalid_input', 400)
    if (!isIso(value.event_at)) fail('invalid_input', 400)
    if (!cleanText(value.type, 100)) fail('invalid_input', 400)
    if (value.amount != null && !isInt(value.amount)) fail('invalid_input', 400)
    if (value.duration_min != null && (!isInt(value.duration_min) || value.duration_min < 0)) {
      fail('invalid_input', 400)
    }
    const status = value.status ?? 'done'
    if (!STATUS_SET.has(status)) fail('invalid_input', 400)
    if (value.note != null && (typeof value.note !== 'string' || value.note.length > 500)) {
      fail('invalid_input', 400)
    }
    return {
      kind,
      event_at: new Date(value.event_at).toISOString(),
      type: value.type,
      amount: value.amount ?? null,
      duration_min: value.duration_min ?? null,
      status,
      note: value.note ?? null,
    }
  }

  const validatePatch = (value) => {
    if (!value || typeof value !== 'object') fail('invalid_input', 400)
    const patch = {}
    if (value.event_at !== undefined) {
      if (!isIso(value.event_at)) fail('invalid_input', 400)
      patch.event_at = new Date(value.event_at).toISOString()
    }
    if (value.type !== undefined) {
      if (!cleanText(value.type, 100)) fail('invalid_input', 400)
      patch.type = value.type
    }
    if (value.amount !== undefined) {
      if (value.amount !== null && !isInt(value.amount)) fail('invalid_input', 400)
      patch.amount = value.amount
    }
    if (value.duration_min !== undefined) {
      if (
        value.duration_min !== null &&
        (!isInt(value.duration_min) || value.duration_min < 0)
      ) {
        fail('invalid_input', 400)
      }
      patch.duration_min = value.duration_min
    }
    if (value.status !== undefined) {
      if (!STATUS_SET.has(value.status)) fail('invalid_input', 400)
      patch.status = value.status
    }
    if (value.note !== undefined) {
      if (value.note !== null && (typeof value.note !== 'string' || value.note.length > 500)) {
        fail('invalid_input', 400)
      }
      patch.note = value.note
    }
    if (Object.keys(patch).length === 0) fail('invalid_input', 400)
    return patch
  }

  const csvCell = (value) => {
    const text = value == null ? '' : String(value)
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  async function exportCsv(tz) {
    const all = []
    for (let offset = 0; offset < 20000; offset += PAGE) {
      const page = rows(
        await db
          .from('events')
          .select('id,kind,event_at,ended_at,type,amount,duration_min,note')
          .order('event_at', { ascending: false })
          .range(offset, offset + PAGE - 1)
      )
      all.push(...page)
      if (page.length < PAGE) break
    }
    const label = { feeding: '吃奶', diaper: '尿不湿' }
    const lines = [['日期', '时间', '类别', '内容', '毫升', '分钟', '结束时间', '备注'].join(',')]
    for (const r of all) {
      const start = localParts(r.event_at, tz)
      const end = r.ended_at ? localParts(r.ended_at, tz) : { date: '', time: '' }
      lines.push(
        [
          start.date,
          start.time,
          label[r.kind] ?? r.kind,
          r.type,
          r.amount ?? '',
          r.duration_min ?? '',
          r.ended_at ? `${end.date} ${end.time}` : '',
          r.note ?? '',
        ]
          .map(csvCell)
          .join(',')
      )
    }
    return '\ufeff' + lines.join('\r\n')
  }

  return async (ctx) => {
    const request = ctx.request
    const url = new URL(request.url)
    const pathname = url.pathname
    const match = pathname.match(/^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/.*)?$/)
    if (!match) fail('not_found', 404)
    const path = match[1] || '/'
    const method = request.method

    if (path === '/api/health' && method === 'GET') {
      return json({ ok: true, service: 'baby-tracker' })
    }

    if (path === '/api/bootstrap' && method === 'GET') {
      const tz = pickTimeZone(url.searchParams.get('tz'))
      const rawDays = Number(url.searchParams.get('days') ?? '14')
      const days = Math.min(Math.max(Number.isFinite(rawDays) ? rawDays : 14, 1), 60)
      const [options, events, counts, latest] = await Promise.all([
        readOptions(),
        recentEvents(days),
        dayCounts(),
        latestTimes(),
      ])
      return json({ options, events, dayCounts: counts, latest })
    }

    if (path === '/api/events' && method === 'GET') {
      const day = url.searchParams.get('day')
      if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
        return json(await listDay(day))
      }
      const rawLimit = Number(url.searchParams.get('limit') ?? '200')
      const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 200, 1), 1000)
      return json(await listEvents(limit))
    }

    if (path === '/api/events/days' && method === 'GET') {
      return json(await dayCounts())
    }

    if (path === '/api/events' && method === 'POST') {
      const input = validateCreate(await body(request))
      if (input.status === 'running') {
        rows(await db.from('events').delete().eq('status', 'running'))
      }
      const now = new Date().toISOString()
      const record = {
        id: crypto.randomUUID(),
        kind: input.kind,
        day: dayKey(input.event_at, pickTimeZone(url.searchParams.get('tz'))),
        event_at: input.event_at,
        ended_at: endedAtFrom(input.event_at, input.duration_min),
        type: input.type,
        amount: input.amount,
        duration_min: input.duration_min,
        status: input.status,
        note: input.note,
        created_at: now,
      }
      const created = row(
        await db.from('events').insert(record).select(COLUMNS).single()
      )
      await recountDay(record.day, record.kind)
      return json(created, 201)
    }

    const eventMatch = path.match(/^\/api\/events\/([0-9a-f-]{36})$/)
    if (eventMatch && method === 'PATCH') {
      const id = eventMatch[1]
      const patch = validatePatch(await body(request))
      const current = row(
        await db.from('events').select(`${COLUMNS},day`).eq('id', id).limit(1)
      )
      const existing = Array.isArray(current) ? current[0] : current
      if (!existing) fail('not_found', 404)

      const next = { ...patch }
      if (patch.event_at !== undefined || patch.duration_min !== undefined) {
        const start = patch.event_at ?? existing.event_at
        const duration =
          patch.duration_min !== undefined ? patch.duration_min : existing.duration_min
        next.ended_at = endedAtFrom(start, duration)
      }
      if (patch.event_at !== undefined) {
        next.day = dayKey(patch.event_at, pickTimeZone(url.searchParams.get('tz')))
      }
      const updated = row(
        await db.from('events').update(next).eq('id', id).select(COLUMNS).single()
      )
      const oldDay = existing.day
      const newDay = next.day ?? existing.day
      if (oldDay !== newDay) await recountDay(oldDay, existing.kind)
      await recountDay(newDay, existing.kind)
      return json(updated)
    }

    if (eventMatch && method === 'DELETE') {
      const id = eventMatch[1]
      const found = rows(
        await db.from('events').select('id,day,kind').eq('id', id).limit(1)
      )
      if (!found.length) fail('not_found', 404)
      const deleted = await db.from('events').delete().eq('id', id)
      if (deleted?.error) fail('database_error', 503)
      await recountDay(found[0].day, found[0].kind)
      return new Response(null, { status: 204, headers: JSON_HEADERS })
    }

    if (path === '/api/options' && method === 'GET') {
      return json(await readOptions())
    }

    if (path === '/api/options' && method === 'PUT') {
      const input = await body(request)
      const strings = (value) =>
        Array.isArray(value) &&
        value.length <= 50 &&
        value.every((v) => cleanText(v, 40))
      if (!strings(input?.types)) {
        fail('invalid_input', 400)
      }
      if (
        !Array.isArray(input?.amounts) ||
        input.amounts.length > 50 ||
        !input.amounts.every((v) => isInt(v) && v >= 0 && v <= 5000)
      ) {
        fail('invalid_input', 400)
      }
      await saveOption('types', input.types)
      await saveOption('amounts', input.amounts)
      return json(await readOptions())
    }

    if (path === '/api/export' && method === 'GET') {
      const tz = pickTimeZone(url.searchParams.get('tz'))
      const csv = await exportCsv(tz)
      const today = localParts(new Date().toISOString(), tz).date
      return new Response(csv, {
        status: 200,
        headers: {
          ...JSON_HEADERS,
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="baby-records-${today}.csv"`,
        },
      })
    }

    fail('not_found', 404)
  }
}
