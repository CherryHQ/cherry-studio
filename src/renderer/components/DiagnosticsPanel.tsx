import { cn } from '@cherrystudio/ui/lib/utils'
import { type ComponentProps, type ReactNode, useId } from 'react'

export interface DiagnosticsPanelProps extends Omit<ComponentProps<'section'>, 'title'> {
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly actions?: ReactNode
  readonly headerClassName?: string
  readonly bodyClassName?: string
}

export function DiagnosticsPanel({
  title,
  description,
  actions,
  headerClassName,
  bodyClassName,
  className,
  children,
  'aria-labelledby': ariaLabelledBy,
  ...props
}: DiagnosticsPanelProps) {
  const titleId = useId()

  return (
    <section
      aria-labelledby={ariaLabelledBy ?? titleId}
      className={cn('min-w-0 overflow-hidden rounded-xl border border-border bg-background-subtle', className)}
      {...props}>
      <div className={cn('flex flex-wrap items-start justify-between gap-3 px-4 py-3', headerClassName)}>
        <div className="min-w-0">
          <h2 id={titleId} className="font-medium text-sm">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-muted-foreground text-xs">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className={cn(bodyClassName)}>{children}</div> : null}
    </section>
  )
}
