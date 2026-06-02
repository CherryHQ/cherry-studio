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
    <div role="listitem" className="flex items-center gap-1.5 rounded-md bg-background-subtle px-2 py-1">
      <Icon className={iconClassName} />

      <span className="min-w-0 flex-1 truncate text-foreground text-xs leading-4">{name}</span>
      {meta ? <span className="shrink-0 text-foreground-muted text-xs leading-4">{meta}</span> : null}

      <button
        type="button"
        aria-label={removeLabel}
        className="shrink-0 text-foreground-muted hover:text-destructive"
        onClick={onRemove}>
        <X className="size-3" />
      </button>
    </div>
  )
}

export default SelectionListItem
