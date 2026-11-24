import { ChevronDown } from 'lucide-react'
import { type ComponentProps, type ComponentPropsWithoutRef, type ReactNode } from 'react'

import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'

export function DialogModelFrame({ invalid, children }: { invalid?: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex w-full min-w-0 items-center transition-colors',
        invalid && 'rounded-md ring-1 ring-destructive/50 ring-offset-1 ring-offset-background'
      )}>
      {children}
    </div>
  )
}

type DialogModelTriggerProps = Omit<ComponentPropsWithoutRef<typeof Button>, 'children'> & {
  displayLabel: ReactNode
  model?: ComponentProps<typeof ModelAvatar>['model']
  ariaLabel?: string
  ariaLabelledBy?: string
  chevronClassName?: string
}

export const DialogModelTrigger = ({
  ref,
  displayLabel,
  disabled,
  model,
  ariaLabel,
  ariaLabelledBy,
  chevronClassName,
  className,
  type,
  ...props
}: DialogModelTriggerProps & { ref?: React.RefObject<HTMLButtonElement | null> }) => (
  <Button
    {...props}
    ref={ref}
    type={type ?? 'button'}
    variant="ghost"
    size="sm"
    disabled={disabled}
    aria-label={ariaLabel}
    aria-labelledby={ariaLabelledBy}
    className={cn(
      // Mirrors the shared SelectTrigger recipe (bg-muted/50, borderless, rounded-lg).
      'h-8 max-w-full min-w-0 shrink-0 justify-between gap-2 rounded-lg bg-muted/50 px-2.5 text-sm font-normal shadow-none transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground aria-expanded:bg-muted',
      model ? 'text-foreground' : 'text-muted-foreground',
      className
    )}>
    <span className="flex min-w-0 flex-1 items-center gap-2">
      {model ? <ModelAvatar model={model} size={18} /> : null}
      <span className="min-w-0 flex-1 truncate text-left">{displayLabel}</span>
    </span>
    <ChevronDown
      aria-hidden="true"
      className={cn('size-3.5 shrink-0 text-muted-foreground transition-opacity', chevronClassName)}
    />
  </Button>
)

DialogModelTrigger.displayName = 'DialogModelTrigger'
