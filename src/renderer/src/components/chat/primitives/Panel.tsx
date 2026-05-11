import { cn } from '@cherrystudio/ui/lib/utils'
import type { ComponentProps, ReactNode } from 'react'

type PanelVariant = 'plain' | 'surface' | 'bordered'
type PanelPadding = 'none' | 'sm' | 'md'

export interface PanelProps extends Omit<ComponentProps<'section'>, 'title'> {
  actions?: ReactNode
  bodyClassName?: string
  description?: ReactNode
  footer?: ReactNode
  footerClassName?: string
  headerClassName?: string
  padding?: PanelPadding
  title?: ReactNode
  variant?: PanelVariant
}

const variantClassNames: Record<PanelVariant, string> = {
  plain: '',
  surface: 'bg-background',
  bordered: 'border border-border bg-background shadow-xs'
}

const paddingClassNames: Record<PanelPadding, string> = {
  none: '',
  sm: 'p-2',
  md: 'p-3'
}

export function Panel({
  actions,
  bodyClassName,
  children,
  className,
  description,
  footer,
  footerClassName,
  headerClassName,
  padding = 'md',
  title,
  variant = 'surface',
  ...props
}: PanelProps) {
  const hasHeader = title || description || actions

  return (
    <section
      data-slot="chat-panel"
      className={cn('min-w-0 rounded-lg', variantClassNames[variant], className)}
      {...props}>
      {hasHeader && (
        <div
          data-slot="chat-panel-header"
          className={cn(
            'flex min-w-0 items-start justify-between gap-3 border-border/60 border-b p-3',
            headerClassName
          )}>
          <div className="min-w-0">
            {title && <div className="truncate font-medium text-foreground text-sm leading-5">{title}</div>}
            {description && <div className="mt-0.5 text-muted-foreground text-xs leading-5">{description}</div>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
      )}
      <div data-slot="chat-panel-body" className={cn('min-w-0', paddingClassNames[padding], bodyClassName)}>
        {children}
      </div>
      {footer && (
        <div data-slot="chat-panel-footer" className={cn('border-border/60 border-t p-3', footerClassName)}>
          {footer}
        </div>
      )}
    </section>
  )
}
