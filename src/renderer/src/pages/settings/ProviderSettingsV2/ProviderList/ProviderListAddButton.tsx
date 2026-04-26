import { PlusIcon } from 'lucide-react'

interface ProviderListAddButtonProps {
  label: string
  disabled: boolean
  onAdd: () => void
}

export default function ProviderListAddButton({ label, disabled, onAdd }: ProviderListAddButtonProps) {
  return (
    <div className="shrink-0 border-foreground/[0.04] border-t px-2.5 py-2">
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        className="flex w-full items-center justify-center gap-2 rounded-3xs border border-border/40 border-dashed bg-transparent py-2 text-[13px] text-muted-foreground/70 shadow-none transition-colors hover:bg-accent/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-40">
        <PlusIcon size={14} />
        <span>{label}</span>
      </button>
    </div>
  )
}
