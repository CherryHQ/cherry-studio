import type React from 'react'

import { cn } from '@renderer/utils/style'

type McpDetailListProps = React.ComponentPropsWithoutRef<'dl'>

interface McpDetailItemProps extends React.ComponentPropsWithoutRef<'div'> {
  label: React.ReactNode
  labelClassName?: string
  contentClassName?: string
}

export const McpDetailList = ({ className, ...props }: McpDetailListProps) => (
  <dl className={cn('overflow-hidden rounded-md border border-border bg-background text-sm', className)} {...props} />
)

export const McpDetailItem = ({
  label,
  className,
  labelClassName,
  contentClassName,
  children,
  ...props
}: McpDetailItemProps) => (
  <div
    className={cn(
      'grid grid-cols-[minmax(120px,0.32fr)_minmax(0,1fr)] border-b border-border last:border-b-0',
      className
    )}
    {...props}>
    <dt
      className={cn(
        'min-w-0 bg-muted/35 px-3 py-2 text-sm leading-5 text-foreground',
        'wrap-anywhere wrap-break-word whitespace-normal',
        labelClassName
      )}>
      {label}
    </dt>
    <dd
      className={cn(
        'min-w-0 px-3 py-2 text-sm leading-5 text-foreground',
        'wrap-anywhere wrap-break-word whitespace-normal',
        contentClassName
      )}>
      {children}
    </dd>
  </div>
)
