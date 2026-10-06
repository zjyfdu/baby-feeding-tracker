import { useEffect, useState } from 'react'
import { fmtTime, toLocalInput } from '@/lib/time'

const MINUTE_PRESETS = [
  { m: 0, label: '刚刚' },
  { m: 5, label: '5分钟前' },
  { m: 15, label: '15分钟前' },
  { m: 30, label: '30分钟前' },
  { m: 60, label: '1小时前' },
]

interface TimePickerProps {
  /** Called with the selected timestamp (ms) whenever it changes. */
  onChange: (ms: number | null) => void
  /** When editing an existing record, start from its exact time. */
  initialMs?: number
}

export default function TimePicker({ onChange, initialMs }: TimePickerProps) {
  const [minutesAgo, setMinutesAgo] = useState(0)
  const [useCustom, setUseCustom] = useState(() => initialMs != null)
  const [customAt, setCustomAt] = useState(() =>
    toLocalInput(initialMs != null ? new Date(initialMs) : new Date())
  )
  const [now, setNow] = useState(() => Date.now())

  // Keeps "X分钟前" presets honest while the sheet stays open
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(t)
  }, [])

  const rawMs = useCustom ? new Date(customAt).getTime() : now - minutesAgo * 60000
  const valid = Number.isFinite(rawMs)

  useEffect(() => {
    onChange(valid ? rawMs : null)
  }, [rawMs, valid, onChange])

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {MINUTE_PRESETS.map((p) => (
          <button
            key={p.m}
            type="button"
            onClick={() => {
              setUseCustom(false)
              setMinutesAgo(p.m)
            }}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              !useCustom && minutesAgo === p.m
                ? 'bg-rose-500 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            if (!customAt) setCustomAt(toLocalInput(new Date()))
            setUseCustom(true)
          }}
          className={`rounded-full px-4 py-2 text-sm font-medium transition ${
            useCustom
              ? 'bg-rose-500 text-white shadow-sm'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          指定时间
        </button>
      </div>

      {useCustom && (
        <div className="mb-3 rounded-xl bg-slate-50 p-3">
          <input
            type="datetime-local"
            value={customAt}
            onChange={(e) => setCustomAt(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
          />
          <p className="mt-1.5 text-xs text-slate-500">可以直接补记今天或更早的具体时间</p>
        </div>
      )}

      <p className="mb-4 text-xs text-slate-500">
        将记录为：
        <span className="font-medium text-slate-700">
          {valid ? fmtTime(new Date(rawMs).toISOString()) : '—'}
        </span>
      </p>
    </div>
  )
}
