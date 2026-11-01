import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Pencil, Plus, Settings, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  api,
  exportUrl,
  fetchBootstrap,
  fetchDay,
  type CareEvent,
  type CareOptions,
  type DayCount,
  type EventKind,
} from '@/lib/api'
import { dateKey, diffText, fmtTime } from '@/lib/time'
import CheckInSheet from './CheckInSheet'

const DEFAULT_OPTIONS: CareOptions = {
  types: ['母乳', '奶粉'],
  amounts: [30, 60, 90, 120, 150, 180],
}

/** Days loaded in the first paint; older days are fetched when their tab is tapped. */
const WINDOW_DAYS = 14

const CACHE_KEY = 'baby-care-cache-v3'

interface Snapshot {
  options: CareOptions
  events: CareEvent[]
  dayCounts: DayCount[]
  latest: Partial<Record<EventKind, string | null>>
}

/** Show the last known data right away, then refresh in the background. */
function readCache(): Snapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed?.events)) return null
    return {
      options: { ...DEFAULT_OPTIONS, ...(parsed.options ?? {}) },
      events: parsed.events as CareEvent[],
      dayCounts: Array.isArray(parsed.dayCounts) ? (parsed.dayCounts as DayCount[]) : [],
      latest: parsed.latest ?? {},
    }
  } catch {
    return null
  }
}

function writeCache(snapshot: Snapshot) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...snapshot, at: Date.now() }))
  } catch {
    /* storage full or unavailable — not critical */
  }
}

/** Days covered by the recent window, counting back from today. */
function windowDays(today: string): string[] {
  const out: string[] = []
  const [y, m, d] = today.split('-').map(Number)
  const base = new Date(y, m - 1, d)
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const day = new Date(base)
    day.setDate(base.getDate() - i)
    out.push(dateKey(day.toISOString()))
  }
  return out
}

/** Every statistic is measured from the moment the event started. */
const startTimeMs = (e: CareEvent) => new Date(e.event_at).getTime()

function computeStats(events: CareEvent[], now: number, latestAt: string | null) {
  // Measured from when the last feeding started, even if that day is not loaded
  const sinceLast = latestAt ? now - new Date(latestAt).getTime() : null

  const today0 = new Date(now)
  today0.setHours(0, 0, 0, 0)
  const todayCount = events.filter((e) => startTimeMs(e) >= today0.getTime()).length

  // Average gap between today's records only
  const times = events
    .filter((e) => startTimeMs(e) >= today0.getTime())
    .map(startTimeMs)
    .sort((a, b) => a - b)
  let avg: number | null = null
  if (times.length >= 2) {
    let sum = 0
    for (let i = 1; i < times.length; i++) sum += times[i] - times[i - 1]
    avg = sum / (times.length - 1)
  }

  const d = new Date(now)
  const y0 = new Date(d)
  y0.setDate(d.getDate() - 1)
  y0.setHours(0, 0, 0, 0)
  const ySame = new Date(y0)
  ySame.setHours(d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds())
  const yestCount = events.filter((e) => {
    const t = startTimeMs(e)
    return t >= y0.getTime() && t <= ySame.getTime()
  }).length

  return { sinceLast, todayCount, avg, yestCount }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3 text-center">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-1 text-base font-bold leading-tight text-slate-800">{value}</p>
    </div>
  )
}

interface TagEditorProps {
  label: string
  values: string[]
  onChange: (values: string[]) => void
  placeholder: string
  numeric?: boolean
  tone: 'rose' | 'amber' | 'sky'
}

function TagEditor({ label, values, onChange, placeholder, numeric, tone }: TagEditorProps) {
  const [draft, setDraft] = useState('')
  const toneClass =
    tone === 'rose'
      ? 'bg-rose-100 text-rose-700'
      : tone === 'amber'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-sky-100 text-sky-700'

  const add = () => {
    const v = draft.trim()
    if (!v) return
    if (numeric && isNaN(Number(v))) return
    const next = numeric ? String(Number(v)) : v
    if (!values.includes(next)) onChange([...values, next])
    setDraft('')
  }

  return (
    <div className="mb-4">
      <p className="mb-2 text-sm font-medium text-slate-600">{label}</p>
      <div className="mb-2 flex flex-wrap gap-2">
        {values.map((v, i) => (
          <span
            key={i}
            className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-sm ${toneClass}`}
          >
            {numeric ? `${v}ml` : v}
            <button
              onClick={() => onChange(values.filter((_, j) => j !== i))}
              aria-label="移除"
              className="opacity-60 hover:opacity-100"
            >
              <X size={14} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          type={numeric ? 'number' : 'text'}
          min={0}
          placeholder={placeholder}
          className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
        />
        <button onClick={add} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-white">
          添加
        </button>
      </div>
    </div>
  )
}

export default function BabyTracker() {
  // Paint immediately from the last visit's data, then verify with the server.
  const cached = useMemo(readCache, [])
  const [events, setEvents] = useState<CareEvent[]>(() => cached?.events ?? [])
  const [options, setOptions] = useState<CareOptions>(() => cached?.options ?? DEFAULT_OPTIONS)
  const [dayCounts, setDayCounts] = useState<DayCount[]>(() => cached?.dayCounts ?? [])
  const [latest, setLatest] = useState<Partial<Record<EventKind, string | null>>>(
    () => cached?.latest ?? {}
  )
  const [now, setNow] = useState<number>(() => Date.now())
  const [loading, setLoading] = useState(() => !cached)
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    dateKey(new Date().toISOString())
  )
  // Days already in `events`: the initial window plus whatever was fetched later
  const [loadedDays, setLoadedDays] = useState<string[]>(() =>
    windowDays(dateKey(new Date().toISOString()))
  )
  const [dayLoading, setDayLoading] = useState(false)
  const [editing, setEditing] = useState<CareEvent | null>(null)
  const [sheet, setSheet] = useState<'none' | 'checkin' | 'settings'>('none')

  const [editTypes, setEditTypes] = useState<string[]>([])
  const [editAmounts, setEditAmounts] = useState<string[]>([])
  const [exporting, setExporting] = useState(false)

  const loadAll = useCallback(async (silent = false) => {
    // The server keeps serving while its storage warms up, so retry briefly
    // before telling the user something went wrong.
    let lastError: unknown = null
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const data = await fetchBootstrap()
        const next: CareOptions = {
          types: data.options.types?.length ? data.options.types : DEFAULT_OPTIONS.types,
          amounts: data.options.amounts?.length ? data.options.amounts : DEFAULT_OPTIONS.amounts,
        }
        const todayNow = dateKey(new Date().toISOString())
        setOptions(next)
        setEvents(data.events)
        setDayCounts(data.dayCounts)
        setLatest(data.latest)
        setLoadedDays(windowDays(todayNow))
        writeCache({ options: next, events: data.events, dayCounts: data.dayCounts, latest: data.latest })
        lastError = null
        break
      } catch (e) {
        lastError = e
        await new Promise((r) => setTimeout(r, 1500))
      }
    }
    if (lastError && !silent) {
      toast.error(lastError instanceof Error ? lastError.message : '加载失败')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadAll(Boolean(cached))
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [loadAll, cached])

  // All records of the current kind, newest first (drives stats and "距上次")
  const cache = useCallback(
    (nextEvents: CareEvent[], nextOptions = options, nextDays = dayCounts, nextLatest = latest) =>
      writeCache({
        options: nextOptions,
        events: nextEvents,
        dayCounts: nextDays,
        latest: nextLatest,
      }),
    [options, dayCounts, latest]
  )

  // All records, newest first (drives stats and "距上次")
  const feedEvents = useMemo(
    () => [...events].sort((a, b) => startTimeMs(b) - startTimeMs(a)),
    [events]
  )
  const stats = useMemo(
    () => computeStats(feedEvents, now, latest.feeding ?? null),
    [feedEvents, now, latest]
  )

  const todayKey = dateKey(new Date(now).toISOString())
  const yesterdayKey = dateKey(new Date(now - 86400000).toISOString())

  // Date tabs come from the per-day summary, so the full history stays browsable
  // even though only the recent window is loaded.
  const dateTabs = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of dayCounts) {
      counts.set(d.day, (counts.get(d.day) ?? 0) + d.count)
    }
    if (!counts.has(todayKey)) counts.set(todayKey, 0)
    return [...counts.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, count]) => ({ key, count }))
  }, [dayCounts, todayKey])

  // Fall back to today when the selected day no longer exists for this tab
  const activeDate = dateTabs.some((d) => d.key === selectedDate) ? selectedDate : todayKey

  const visible = useMemo(
    () => feedEvents.filter((e) => dateKey(e.event_at) === activeDate),
    [feedEvents, activeDate]
  )

  // Tap a day outside the loaded window: fetch just that day's records.
  const pickDate = async (key: string) => {
    setSelectedDate(key)
    if (loadedDays.includes(key) || dayLoading) return
    setDayLoading(true)
    try {
      const rows = await fetchDay(key)
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id))
        const next = [...prev, ...rows.filter((e) => !seen.has(e.id))]
        cache(next)
        return next
      })
      setLoadedDays((prev) => [...prev, key])
    } catch {
      toast.error('加载这天记录失败')
    } finally {
      setDayLoading(false)
    }
  }

  const dateLabel = (key: string) => {
    if (key === todayKey) return '今天'
    if (key === yesterdayKey) return '昨天'
    const [, m, d] = key.split('-')
    return `${Number(m)}月${Number(d)}日`
  }

  const openCheckin = () => {
    setEditing(null)
    setSheet('checkin')
  }

  const openEdit = (event: CareEvent) => {
    setEditing(event)
    setSheet('checkin')
  }

  const openSettings = () => {
    setEditTypes(options.types)
    setEditAmounts(options.amounts.map(String))
    setSheet('settings')
  }

  const close = () => setSheet('none')

  const handleSaved = (saved: CareEvent, isEdit: boolean) => {
    const next = isEdit
      ? events.map((e) => (e.id === saved.id ? saved : e))
      : [saved, ...events]
    setEvents(next)

    // Keep "距上次" honest: a new record or a moved newest record changes it.
    const cur = latest[saved.kind]
    const curMs = cur ? Date.parse(cur) : 0
    const savedMs = startTimeMs(saved)
    let nextLatest = latest
    const old = isEdit ? events.find((e) => e.id === saved.id) : undefined
    if (old && old.event_at === cur) {
      const max = next
        .filter((e) => e.kind === saved.kind)
        .reduce((m, e) => Math.max(m, startTimeMs(e)), 0)
      nextLatest = { ...latest, [saved.kind]: max ? new Date(max).toISOString() : null }
    } else if (savedMs > curMs || (!isEdit && savedMs === curMs)) {
      nextLatest = { ...latest, [saved.kind]: saved.event_at }
    }
    if (nextLatest !== latest) setLatest(nextLatest)

    let nextCounts = dayCounts
    if (!isEdit) {
      const key = dateKey(saved.event_at)
      const hit = dayCounts.find((d) => d.day === key && d.kind === saved.kind)
      nextCounts = hit
        ? dayCounts.map((d) => (d === hit ? { ...d, count: d.count + 1 } : d))
        : [...dayCounts, { day: key, kind: saved.kind, count: 1 }]
      setDayCounts(nextCounts)
    }
    cache(next, options, nextCounts, nextLatest)

    // Jump to the day the record belongs to so it is immediately visible
    setSelectedDate(dateKey(saved.event_at))
  }

  const handleDelete = async (id: string) => {
    const target = events.find((e) => e.id === id)
    try {
      await api.deleteEvent(id)
      const next = events.filter((e) => e.id !== id)
      setEvents(next)
      if (target) {
        const key = dateKey(target.event_at)
        const nextCounts = dayCounts
          .map((d) =>
            d.day === key && d.kind === target.kind ? { ...d, count: d.count - 1 } : d
          )
          .filter((d) => d.count > 0)
        setDayCounts(nextCounts)
        if (target.event_at === latest[target.kind]) {
          const max = next
            .filter((e) => e.kind === target.kind)
            .reduce((m, e) => Math.max(m, startTimeMs(e)), 0)
          const nextLatest = {
            ...latest,
            [target.kind]: max ? new Date(max).toISOString() : null,
          }
          setLatest(nextLatest)
          cache(next, options, nextCounts, nextLatest)
        } else {
          cache(next, options, nextCounts)
        }
      } else {
        cache(next)
      }
      toast.success('已删除')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const res = await fetch(exportUrl())
      if (!res.ok) throw new Error('export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `宝宝记录-${dateKey(new Date().toISOString())}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('已导出，可在下载里查看')
    } catch {
      toast.error('导出失败，请稍后再试')
    } finally {
      setExporting(false)
    }
  }

  const handleSaveOptions = async () => {
    const next: CareOptions = {
      types: editTypes.map((t) => t.trim()).filter(Boolean),
      amounts: editAmounts.map((a) => a.trim()).filter(Boolean).map(Number),
    }
    if (next.types.length === 0) {
      toast.error('至少保留一个喂养类型')
      return
    }
    try {
      const saved = await api.saveOptions(next)
      setOptions(saved)
      cache(events, saved)
      toast.success('选项已保存')
      close()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-rose-50 via-orange-50 to-amber-50 text-slate-800">
      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-md flex-col">
        <header className="px-5 pb-2 pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-rose-700">🥜 吃奶了吗</h1>
              <p className="mt-0.5 text-xs text-slate-500">记录每一顿奶</p>
            </div>
            <button
              onClick={openSettings}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/70 text-slate-600 shadow-sm active:scale-95"
              aria-label="选项设置"
            >
              <Settings size={18} />
            </button>
          </div>
        </header>

        <main className="flex-1 space-y-4 overflow-y-auto px-4 pb-32">
          <section className="rounded-3xl bg-white/85 p-5 shadow-sm backdrop-blur">
            <div className="text-center">
              <p className="text-xs text-slate-500">距离上次吃奶</p>
              <p className="mt-1 text-4xl font-extrabold text-rose-600">
                {stats.sinceLast == null ? '—' : diffText(stats.sinceLast)}
              </p>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <Stat label="今天已吃" value={`${stats.todayCount} 顿`} />
              <Stat label="平均间隔" value={stats.avg == null ? '—' : diffText(stats.avg)} />
              <Stat label="昨日同期" value={`${stats.yestCount} 顿`} />
            </div>
          </section>

          <section>
            <h2 className="mb-2 px-1 text-sm font-semibold text-slate-600">吃奶记录</h2>

            {!loading && dateTabs.length > 0 && (
              <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
                {dateTabs.map((d) => (
                  <button
                    key={d.key}
                    onClick={() => pickDate(d.key)}
                    className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      d.key === activeDate
                        ? 'bg-slate-800 text-white'
                        : 'bg-white/80 text-slate-600'
                    }`}
                  >
                    {dateLabel(d.key)} · {d.count}
                  </button>
                ))}
              </div>
            )}

            {loading || (dayLoading && visible.length === 0) ? (
              <p className="px-1 py-6 text-center text-sm text-slate-400">加载中…</p>
            ) : visible.length === 0 ? (
              <div className="rounded-2xl bg-white/70 px-4 py-8 text-center text-sm text-slate-400">
                {activeDate === todayKey
                  ? '今天还没有吃奶记录，点下方按钮打第一次卡吧 👇'
                  : `${dateLabel(activeDate)}没有记录`}
              </div>
            ) : (
              <ul className="space-y-2">
                {visible.map((e) => {
                  const idx = feedEvents.findIndex((x) => x.id === e.id)
                  const prev = idx >= 0 ? feedEvents[idx + 1] : undefined
                  const gap = prev ? startTimeMs(e) - startTimeMs(prev) : null
                  return (
                  <li
                    key={e.id}
                    className="flex items-center justify-between rounded-2xl bg-white/80 px-4 py-3 shadow-sm"
                  >
                    <div>
                      <p className="font-medium text-slate-800">
                        {e.type}
                        {e.duration_min != null && (
                          <span className="ml-1 text-emerald-600">· {e.duration_min}分钟</span>
                        )}
                        {e.amount != null && (
                          <span className="ml-1 text-rose-500">· {e.amount}ml</span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500">
                        {fmtTime(e.event_at)}
                        {gap != null && (
                          <span className="ml-1 text-slate-400">· 距上次 {diffText(gap)}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEdit(e)}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 hover:bg-sky-50 hover:text-sky-500 active:scale-95"
                        aria-label="编辑"
                      >
                        <Pencil size={17} />
                      </button>
                      <button
                        onClick={() => handleDelete(e.id)}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-500 active:scale-95"
                        aria-label="删除"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </li>
                  )
                })}
              </ul>
            )}
          </section>
        </main>

        <div className="fixed inset-x-0 bottom-0 z-30">
          <div className="mx-auto flex max-w-md p-4">
            <button
              onClick={openCheckin}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-rose-500 py-3.5 font-bold text-white shadow-lg shadow-rose-500/30 active:scale-[0.98]"
            >
              <Plus size={20} /> 吃奶打卡
            </button>
          </div>
        </div>

        {sheet === 'checkin' && (
          <CheckInSheet
            key={editing ? `edit-${editing.id}` : 'new'}
            options={options}
            event={editing}
            onClose={close}
            onSaved={handleSaved}
          />
        )}

        {sheet === 'settings' && (
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
            onClick={close}
          >
            <div
              className="animate-sheet mx-auto max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-8"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-800">选项设置</h3>
                <button onClick={close} className="text-slate-400" aria-label="关闭">
                  <X size={22} />
                </button>
              </div>

              <TagEditor
                label="喂养类型"
                values={editTypes}
                onChange={setEditTypes}
                placeholder="新增类型，如 混合"
                tone="rose"
              />
              <TagEditor
                label="毫升预设"
                values={editAmounts}
                onChange={setEditAmounts}
                placeholder="新增毫升，如 200"
                numeric
                tone="amber"
              />

              <button
                onClick={handleSaveOptions}
                className="w-full rounded-2xl bg-rose-500 py-3 font-bold text-white active:scale-[0.98]"
              >
                保存选项
              </button>

              <button
                onClick={handleExport}
                disabled={exporting}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 py-3 font-medium text-slate-600 active:scale-[0.98] disabled:opacity-60"
              >
                <Download size={17} />
                {exporting ? '导出中…' : '导出备份（全部记录）'}
              </button>
              <p className="mt-2 text-center text-xs text-slate-400">
                导出成表格文件保存到手机，防止数据丢失
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
