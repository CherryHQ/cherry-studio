import { cn } from '@renderer/utils/style'
import React from 'react'

export const ToolWrapper = ({ className, ref, ...props }: React.ComponentProps<'div'>) =>
  React.createElement('div', {
    ref,
    className: cn(
      'flex size-6 cursor-pointer select-none items-center justify-center rounded-[4px] text-[var(--color-text-3)] transition-all duration-200 ease-in-out',
      'hover:bg-[var(--color-background-soft)] [&:hover_.tool-icon]:text-[var(--color-text-1)]',
      '[&.active]:text-[var(--color-primary)] [&.active_.tool-icon]:text-[var(--color-primary)]',
      '[&_.tool-icon]:size-[14px] [&_.tool-icon]:text-[var(--color-text-3)]',
      className
    ),
    ...props
  })

ToolWrapper.displayName = 'ToolWrapper'
