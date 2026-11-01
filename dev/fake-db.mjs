// In-memory stand-in for the platform database client. Local development only.
const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)))

function compare(a, b) {
  if (a === b) return 0
  if (a == null) return -1
  if (b == null) return 1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a) < String(b) ? -1 : 1
}

function project(item, columns) {
  if (!item) return item
  if (!columns || columns === '*') return clone(item)
  const keys = columns.split(',').map((c) => c.trim())
  const out = {}
  for (const key of keys) out[key] = clone(item[key])
  return out
}

class Query {
  constructor(store, table) {
    this.store = store
    this.table = table
    this.filters = []
    this.orders = []
    this.limitN = null
    this.rangeN = null
    this.action = 'select'
    this.columns = null
    this.singleMode = null
    this.payload = null
  }

  select(columns = '*') {
    this.columns = columns
    return this
  }

  eq(column, value) {
    this.filters.push(['eq', column, value])
    return this
  }

  lt(column, value) {
    this.filters.push(['lt', column, value])
    return this
  }

  gte(column, value) {
    this.filters.push(['gte', column, value])
    return this
  }

  order(column, options = {}) {
    this.orders.push([column, options.ascending !== false])
    return this
  }

  limit(count) {
    this.limitN = count
    return this
  }

  range(from, to) {
    this.rangeN = [from, to]
    return this
  }

  insert(payload) {
    this.action = 'insert'
    this.payload = payload
    return this
  }

  update(payload) {
    this.action = 'update'
    this.payload = payload
    return this
  }

  delete() {
    this.action = 'delete'
    return this
  }

  single() {
    this.singleMode = 'single'
    return this
  }

  maybeSingle() {
    this.singleMode = 'maybe'
    return this
  }

  matches(item) {
    return this.filters.every(([op, column, value]) => {
      if (op === 'eq') return item[column] === value
      if (op === 'lt') return compare(item[column], value) < 0
      if (op === 'gte') return compare(item[column], value) >= 0
      return true
    })
  }

  async exec() {
    const table = this.store.table(this.table)
    let data = null

    if (this.action === 'select') {
      data = table.filter((item) => this.matches(item)).map(clone)
      for (const [column, ascending] of [...this.orders].reverse()) {
        data.sort((a, b) => compare(a[column], b[column]) * (ascending ? 1 : -1))
      }
      if (this.rangeN) data = data.slice(this.rangeN[0], this.rangeN[1] + 1)
      if (this.limitN != null) data = data.slice(0, this.limitN)
      data = data.map((item) => project(item, this.columns))
    } else if (this.action === 'insert') {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload]
      for (const row of incoming) {
        if (this.table === 'events' && table.some((r) => r.id === row.id)) {
          return { data: null, error: { code: 'duplicate_key' } }
        }
        if (this.table === 'event_days' && table.some((r) => r.id === row.id)) {
          return { data: null, error: { code: 'duplicate_key' } }
        }
        if (this.table === 'feed_options' && table.some((r) => r.key === row.key)) {
          return { data: null, error: { code: 'duplicate_key' } }
        }
        table.push(clone(row))
      }
      data = this.columns
        ? incoming.map((row) => project(table.find((r) => r === row) ?? row, this.columns))
        : null
    } else if (this.action === 'update') {
      data = []
      for (const item of table) {
        if (!this.matches(item)) continue
        Object.assign(item, clone(this.payload))
        data.push(project(item, this.columns))
      }
      if (!this.columns) data = null
    } else if (this.action === 'delete') {
      const removed = table.filter((item) => this.matches(item))
      this.store.set(
        this.table,
        table.filter((item) => !this.matches(item))
      )
      data = this.columns ? removed.map((item) => project(item, this.columns)) : null
    }

    if (this.singleMode === 'single') {
      if (!Array.isArray(data) || data.length !== 1) {
        return { data: null, error: { code: 'not_single' } }
      }
      return { data: data[0], error: null }
    }
    if (this.singleMode === 'maybe') {
      return { data: Array.isArray(data) && data.length ? data[0] : null, error: null }
    }
    return { data, error: null }
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject)
  }
}

export function createFakeDatabase(seed = {}) {
  const tables = {
    events: (seed.events ?? []).map(clone),
    event_days: (seed.event_days ?? []).map(clone),
    feed_options: (seed.feed_options ?? []).map(clone),
  }
  return {
    from(table) {
      if (!tables[table]) tables[table] = []
      return new Query(this, table)
    },
    table(name) {
      if (!tables[name]) tables[name] = []
      return tables[name]
    },
    set(name, rows) {
      tables[name] = rows
    },
  }
}
