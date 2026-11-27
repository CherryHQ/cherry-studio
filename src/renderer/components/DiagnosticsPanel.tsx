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
          'flex flex-wrap items-center justify-between gap-3 px-4 py-2',
          variant === 'sectioned' && 'min-h-10 border-border border-b bg-background-subtle py-1'
        )}>
        <div className="min-w-0">
          <h2 id={titleId} className="text-sm font-medium">
            {title}
          </h2>
          {description ? <p className="text-muted-foreground mt-0.5 text-xs">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children ? (
        <div className={cn(variant === 'sectioned' && 'bg-background', bodyClassName)}>{children}</div>
      ) : null}
    </section>
  )
}
