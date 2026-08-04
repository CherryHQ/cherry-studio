import { cn } from '@renderer/utils/style'
import React from 'react'

export const ToolWrapper = ({ className, ref, ...props }: React.ComponentProps<'div'>) =>
  React.createElement('div', {
    ref,
    className: cn(
      'flex size-6 cursor-pointer select-none items-center justify-center rounded-[4px] text-muted-foreground transition-all duration-200 ease-in-out',
      'hover:bg-accent [&:hover_.tool-icon]:text-foreground',
      '[&.active]:text-control-accent [&.active_.tool-icon]:text-control-accent',
      '[&_.tool-icon]:size-[14px] [&_.tool-icon]:text-muted-foreground',
      className
    ),
    ...props
  })

ToolWrapper.displayName = 'ToolWrapper'
