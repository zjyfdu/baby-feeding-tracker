interface ChipProps {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  accent?: 'rose' | 'sky'
}

export default function Chip({ active, onClick, children, accent = 'rose' }: ChipProps) {
  const activeClass =
    accent === 'sky' ? 'bg-sky-500 text-white shadow-sm' : 'bg-rose-500 text-white shadow-sm'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-medium transition ${
        active ? activeClass : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      }`}
    >
      {children}
    </button>
  )
}
