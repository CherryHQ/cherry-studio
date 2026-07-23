import { Alert } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { ComponentProps, ReactNode } from 'react'

export interface ErrorStateProps extends Omit<ComponentProps<'div'>, 'title'> {
  action?: ReactNode
  description?: ReactNode
  icon?: ReactNode
  title?: ReactNode
}

export function ErrorState({ action, className, description, icon, title, ...props }: ErrorStateProps) {
  return (
    <Alert
      data-slot="chat-error-state"
      type="error"
      showIcon
      icon={icon}
      message={title}
      description={description}
      action={action}
      className={cn('min-w-0', className)}
      {...props}
    />
  )
}
