import { Button } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { ChevronDown, X } from 'lucide-react'
import { type ComponentProps, type ReactElement, type ReactNode } from 'react'

interface HistorySourceFilterFieldProps {
  label: string
  icon?: ReactNode
  hasValue: boolean
  clearLabel: string
  onClear: () => void
  /** Renders the shared assistant/agent selector, receiving the styled trigger button. */
  selector: (trigger: ReactElement) => ReactNode
}

/** A trigger styled like a shadcn SelectTrigger; the popover is the reused resource selector. */
const SourceFilterTrigger = ({
  ref,
  label,
  icon,
  hasValue,
  className,
  ...props
}: { label: string; icon?: ReactNode; hasValue: boolean } & ComponentProps<'button'> & {
    ref?: React.RefObject<HTMLButtonElement | null>
  }) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      'inline-flex h-8 w-fit min-w-[128px] max-w-[220px] items-center justify-between gap-2 whitespace-nowrap',
      'rounded-md border border-border bg-transparent px-3 font-normal text-foreground text-xs outline-none transition-colors',
      'hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0',
      'data-[state=open]:border-primary data-[state=open]:ring-3 data-[state=open]:ring-primary/20',
      className
    )}
    {...props}>
    <span className="flex min-w-0 items-center gap-1.5">
      {icon ? <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span> : null}
      <span className={cn('min-w-0 truncate', !hasValue && 'text-muted-foreground')}>{label}</span>
    </span>
    <ChevronDown
      className={cn(
        'size-4 shrink-0 text-muted-foreground',
        hasValue && 'transition-opacity group-focus-within/source-select:opacity-0 group-hover/source-select:opacity-0'
      )}
    />
  </button>
)
SourceFilterTrigger.displayName = 'SourceFilterTrigger'

/**
 * The source (assistant/agent) filter: a Select-styled trigger opening the reused resource selector,
 * with a clear-to-all button that fades in on hover/focus (mirrors the tag selector).
 */
export const HistorySourceFilterField = ({
  label,
  icon,
  hasValue,
  clearLabel,
  onClear,
  selector
}: HistorySourceFilterFieldProps) => (
  <div className="group/source-select relative flex shrink-0 items-center">
    {selector(<SourceFilterTrigger label={label} icon={icon} hasValue={hasValue} />)}
    {hasValue ? (
      <Button
        type="button"
        variant="ghost"
        aria-label={clearLabel}
        onClick={(event) => {
          event.stopPropagation()
          onClear()
        }}
        className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-2 flex size-5 min-h-0 shrink-0 items-center justify-center rounded-full bg-transparent p-0 text-muted-foreground/70 opacity-0 shadow-none transition-[background-color,color,opacity] hover:bg-muted hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-focus-within/source-select:pointer-events-auto group-focus-within/source-select:opacity-100 group-hover/source-select:pointer-events-auto group-hover/source-select:opacity-100">
        <X size={12} />
      </Button>
    ) : null}
  </div>
)
