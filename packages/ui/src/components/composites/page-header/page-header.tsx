import { cn } from '@cherrystudio/ui/lib/utils'
import * as React from 'react'

type PageHeaderProps = Omit<React.ComponentProps<'div'>, 'title'> & {
  title: React.ReactNode
  titleClassName?: string
  action?: React.ReactNode
  bordered?: boolean
}

function PageHeader({ title, titleClassName, action, bordered, className, ...props }: PageHeaderProps) {
  return (
    <div
      data-slot="page-header"
      className={cn(
        'mt-3 mb-2 flex h-8 shrink-0 items-center justify-between gap-2 pr-3 pl-5',
        bordered && 'border-border border-b',
        className
      )}
      {...props}>
      <h2 className={cn('min-w-0 flex-1 truncate font-medium text-foreground text-sm leading-4', titleClassName)}>
        {title}
      </h2>
      {action}
    </div>
  )
}

PageHeader.displayName = 'PageHeader'

export { PageHeader }
export type { PageHeaderProps }
