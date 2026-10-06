import { useCallback, useState } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { api, type CareEvent, type CareOptions, type EventKind } from '@/lib/api'
import Chip from './Chip'
import TimePicker from './TimePicker'

const DURATION_PRESETS = [10, 15, 20, 30]

interface CheckInSheetProps {
  kind: EventKind
  options: CareOptions
  /** When provided the sheet edits this record instead of creating a new one. */
  event?: CareEvent | null
  onClose: () => void
  onSaved: (event: CareEvent, isEdit: boolean) => void
}

export default function CheckInSheet({
  kind,
  options,
  event,
  onClose,
  onSaved,
}: CheckInSheetProps) {
  const isFeeding = kind === 'feeding'
  const isEdit = !!event
  const choices = isFeeding ? options.types : options.diaperStates

  const [eventAtMs, setEventAtMs] = useState<number | null>(() =>
    event ? new Date(event.event_at).getTime() : Date.now()
  )
  const [type, setType] = useState(
    () => event?.type ?? choices[0] ?? (isFeeding ? '母乳' : '💩少')
  )
  const [amount, setAmount] = useState(() =>
    event?.amount != null ? String(event.amount) : ''
  )
  const [duration, setDuration] = useState(() =>
    event?.duration_min != null ? String(event.duration_min) : ''
  )

  const handleTimeChange = useCallback((ms: number | null) => setEventAtMs(ms), [])

  // Shortcut: work out how many minutes have passed since the selected time
  const fillDurationFromNow = () => {
    if (!eventAtMs) {
      toast.error('请先选择开始时间')
      return
    }
    const mins = Math.round((Date.now() - eventAtMs) / 60000)
    if (mins < 1) {
      toast.error('还不到 1 分钟，可以直接填数字')
      return
    }
    setDuration(String(mins))
    toast.success(`已填入 ${mins} 分钟`)
  }

  const handleSave = async () => {
    if (!eventAtMs) {
      toast.error('请选择一个时间')
      return
    }
    if (eventAtMs > Date.now() + 60000) {
      toast.error('不能记录未来的时间')
      return
    }
    const amt = !isFeeding || amount === '' ? null : Number(amount)
    const dur = !isFeeding || duration === '' ? null : Number(duration)
    try {
      if (event) {
        const updated = await api.updateEvent(event.id, {
          event_at: new Date(eventAtMs).toISOString(),
          type,
          amount: amt,
          duration_min: dur,
        })
        onSaved(updated, true)
        toast.success('已保存修改 ✓')
      } else {
        const created = await api.addEvent({
          kind,
          event_at: new Date(eventAtMs).toISOString(),
          type,
          amount: amt,
          duration_min: dur,
        })
        onSaved(created, false)
        toast.success(isFeeding ? '吃奶已记录 ✓' : '尿不湿已记录 ✓')
      }
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        className="animate-sheet mx-auto max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">
            {isEdit
              ? isFeeding
                ? '🍼 编辑吃奶记录'
                : '🧷 编辑尿不湿记录'
              : isFeeding
                ? '🍼 吃奶打卡'
                : '🧷 尿不湿打卡'}
          </h3>
          <button onClick={onClose} className="text-slate-400" aria-label="关闭">
            <X size={22} />
          </button>
        </div>

        <p className="mb-2 text-sm font-medium text-slate-600">
          {isFeeding ? '什么时候吃的' : '什么时候换的'}
        </p>
        <TimePicker
          onChange={handleTimeChange}
          initialMs={event ? new Date(event.event_at).getTime() : undefined}
        />

        <p className="mb-2 text-sm font-medium text-slate-600">
          {isFeeding ? '喂养类型' : '尿不湿情况'}
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          {choices.map((c) => (
            <Chip
              key={c}
              active={type === c}
              accent={isFeeding ? 'rose' : 'sky'}
              onClick={() => setType(c)}
            >
              {c}
            </Chip>
          ))}
        </div>

        {isFeeding && (
          <>
            <p className="mb-2 text-sm font-medium text-slate-600">奶量 (ml)</p>
            <div className="mb-2 flex flex-wrap gap-2">
              {options.amounts.map((a) => (
                <Chip key={a} active={amount === String(a)} onClick={() => setAmount(String(a))}>
                  {a}
                </Chip>
              ))}
            </div>
            <div className="mb-5 flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="自定义"
                className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-sm"
              />
              <span className="text-xs text-slate-500">ml（母乳可留空）</span>
            </div>

            <p className="mb-2 text-sm font-medium text-slate-600">吃了多久（分钟）</p>
            <div className="mb-2 flex flex-wrap gap-2">
              {DURATION_PRESETS.map((d) => (
                <Chip
                  key={d}
                  active={duration === String(d)}
                  onClick={() => setDuration(String(d))}
                >
                  {d} 分钟
                </Chip>
              ))}
            </div>
            <div className="mb-5 flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="自定义"
                className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              />
              <span className="text-xs text-slate-500">分钟（奶粉可留空）</span>
              {isEdit && (
                <button
                  type="button"
                  onClick={fillDurationFromNow}
                  className="ml-auto rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white active:scale-95"
                >
                  吃完了
                </button>
              )}
            </div>
          </>
        )}

        <button
          onClick={handleSave}
          className={`w-full rounded-2xl py-3 font-bold text-white active:scale-[0.98] ${
            isFeeding ? 'bg-rose-500' : 'bg-sky-500'
          }`}
        >
          {isEdit ? '保存修改' : '保存打卡'}
        </button>
      </div>
    </div>
  )
}
