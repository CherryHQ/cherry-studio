import { Button, Tooltip } from '@cherrystudio/ui'
import { CircleAlert, type LucideIcon, X } from 'lucide-react'

interface SelectionListItemProps {
  icon: LucideIcon
  iconClassName: string
  meta?: string
  name: string
  onRemove: () => void
  removeLabel: string
  warning?: string
}

const SelectionListItem = ({
  icon: Icon,
  iconClassName,
  meta,
  name,
  onRemove,
  removeLabel,
  warning
}: SelectionListItemProps) => {
  return (
    <div role="listitem" className="flex items-center justify-between gap-1.5 rounded-md bg-accent/30 px-2 py-1">
      <span className="flex min-w-0 max-w-[70%] shrink-0 basis-[70%] items-center gap-1.5">
        <Icon className={iconClassName} />
        <span className="flex min-w-0 items-center gap-1 text-foreground text-sm leading-4" title={name}>
          <span className="min-w-0 truncate">{name}</span>
          {warning ? (
            <Tooltip content={warning} placement="top" classNames={{ content: 'z-402' }}>
              <CircleAlert className="size-3 shrink-0 text-destructive" aria-label={warning} />
            </Tooltip>
          ) : null}
        </span>
      </span>

      <span className="flex min-w-0 shrink items-center justify-end gap-1.5">
        {meta ? <span className="min-w-0 truncate text-muted-foreground/35 text-xs leading-4">{meta}</span> : null}

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={removeLabel}
          className="size-4 min-h-4 text-muted-foreground/25 hover:bg-transparent hover:text-red-500"
          onClick={onRemove}>
          <X className="size-2.25" />
        </Button>
      </span>
    </div>
  )
}

export default SelectionListItem
