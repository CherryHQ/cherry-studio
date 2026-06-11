import { type LucideIcon, X } from 'lucide-react'

interface SelectionListItemProps {
  icon: LucideIcon
  iconClassName: string
  meta?: string
  name: string
  onRemove: () => void
  removeLabel: string
}

const getPathName = (value: string) => {
  const normalizedValue = value.replace(/[/\\]+$/, '')
  const name = normalizedValue.split(/[/\\]/).pop()?.trim()

  return name || normalizedValue || value
}

const SelectionListItem = ({
  icon: Icon,
  iconClassName,
  meta,
  name,
  onRemove,
  removeLabel
}: SelectionListItemProps) => {
  const displayName = getPathName(name)

  return (
    <div
      role="listitem"
      className="grid min-w-0 max-w-full grid-cols-[auto_minmax(0,1fr)_minmax(0,max-content)_auto] items-center gap-1.5 overflow-hidden rounded-md bg-background-subtle px-2 py-1">
      <Icon className={iconClassName} />

      <span className="min-w-0 truncate text-foreground text-xs leading-4" title={name}>
        {displayName}
      </span>
      {meta ? (
        <span className="min-w-0 max-w-60 truncate text-foreground-muted text-xs leading-4" title={meta}>
          {meta}
        </span>
      ) : null}

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
