import { cn } from '@renderer/utils/style'
import React from 'react'

export const ToolWrapper = ({ className, ref, ...props }: React.ComponentProps<'div'>) =>
  React.createElement('div', {
    ref,
    className: cn(
      'flex size-6 cursor-pointer select-none items-center justify-center rounded-[4px] text-foreground-muted transition-all duration-200 ease-in-out',
      'hover:bg-accent [&:hover_.tool-icon]:text-foreground',
      '[&.active]:text-[var(--color-primary)] [&.active_.tool-icon]:text-[var(--color-primary)]',
      '[&_.tool-icon]:size-[14px] [&_.tool-icon]:text-foreground-muted',
      className
    ),
    ...props
  })

ToolWrapper.displayName = 'ToolWrapper'
