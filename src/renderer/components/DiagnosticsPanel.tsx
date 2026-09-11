import { type ComponentProps, type ReactNode, useId } from 'react'

import { cn } from '@cherrystudio/ui/lib/utils'

export interface DiagnosticsPanelProps extends Omit<ComponentProps<'section'>, 'title'> {
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly actions?: ReactNode
  readonly bodyClassName?: string
  readonly variant?: 'default' | 'sectioned'
}

export function DiagnosticsPanel({
  title,
  description,
  actions,
  bodyClassName,
  className,
  children,
  variant = 'default',
  'aria-labelledby': ariaLabelledBy,
  ...props
}: DiagnosticsPanelProps) {
  const titleId = useId()

  return (
    <section
      aria-labelledby={ariaLabelledBy ?? titleId}
      className={cn(
        'min-w-0 overflow-hidden rounded-xl border border-border',
        variant === 'sectioned' ? 'bg-background' : 'bg-background-subtle',
        className
      )}
      data-variant={variant}
      {...props}>
      <div
        className={cn(
          'flex flex-wrap items-start justify-between gap-3 px-4 py-3',
          variant === 'sectioned' && 'border-border border-b bg-background-subtle'
        )}>
        <div className="min-w-0">
          <h2 id={titleId} className="font-medium text-sm">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-muted-foreground text-xs">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children ? (
        <div className={cn(variant === 'sectioned' && 'bg-background', bodyClassName)}>{children}</div>
      ) : null}
    </section>
  )
}
