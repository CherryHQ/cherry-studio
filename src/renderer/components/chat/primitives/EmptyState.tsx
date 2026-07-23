import {
  EmptyState as UIEmptyState,
  type EmptyStatePreset,
  type EmptyStateProps as UIEmptyStateProps
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { ComponentType, ReactNode } from 'react'

type EmptyStateIcon = ComponentType<{ size?: number; className?: string; strokeWidth?: number }>

export interface EmptyStateProps extends Omit<UIEmptyStateProps, 'icon'> {
  actions?: ReactNode
  icon?: EmptyStateIcon
  iconClassName?: string
  iconSize?: number
  iconStrokeWidth?: number
  id?: string
}

export function EmptyState({
  actions,
  className,
  compact = false,
  description,
  icon: Icon,
  iconClassName,
  iconSize,
  iconStrokeWidth,
  id,
  title,
  ...props
}: EmptyStateProps) {
  if (!actions && !iconClassName && !iconSize && !iconStrokeWidth) {
    return (
      <UIEmptyState
        className={className}
        compact={compact}
        description={description}
        icon={Icon}
        title={title}
        {...props}
      />
    )
  }

  if (!Icon) {
    return (
      <div
        id={id}
        data-slot="chat-empty-state"
        className={cn('flex h-full w-full flex-col items-center justify-center gap-4', className)}>
        <UIEmptyState compact={compact} description={description} title={title} {...props} />
        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </div>
    )
  }

  return (
    <div
      id={id}
      data-slot="chat-empty-state"
      className={cn('flex h-full w-full flex-col items-center justify-center gap-4 text-center', className)}>
      <Icon
        size={iconSize ?? (compact ? 40 : 56)}
        strokeWidth={iconStrokeWidth}
        className={cn('text-muted-foreground', iconClassName)}
      />
      <div className="flex flex-col items-center gap-2">
        {title && <h3 className="m-0 font-medium text-base text-foreground">{title}</h3>}
        {description && <p className="m-0 max-w-xs text-muted-foreground text-sm">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  )
}

export type { EmptyStatePreset }
