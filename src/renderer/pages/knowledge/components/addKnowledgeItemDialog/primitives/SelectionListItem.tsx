import { type LucideIcon, X } from 'lucide-react'

interface SelectionListItemProps {
  icon: LucideIcon
  iconClassName: string
  meta?: string
  name: string
  onRemove: () => void
  removeLabel: string
}

const SelectionListItem = ({
  icon: Icon,
  iconClassName,
  meta,
  name,
  onRemove,
  removeLabel
}: SelectionListItemProps) => {
  return (
    <div role="listitem" className="flex items-center gap-1.5 rounded-md bg-accent/30 px-2 py-1">
      <Icon className={iconClassName} />

      <span className="min-w-0 flex-1 truncate text-foreground text-sm leading-4">{name}</span>
      {meta ? <span className="shrink-0 text-muted-foreground/35 text-xs leading-4">{meta}</span> : null}

      <button
        type="button"
        aria-label={removeLabel}
        className="shrink-0 text-muted-foreground/25 hover:text-red-500"
        onClick={onRemove}>
        <X className="size-2.25" />
      </button>
    </div>
  )
}

export default SelectionListItem
