import React from 'react'

import { cn } from '@renderer/utils/style'

export const ToolWrapper = ({ className, ref, ...props }: React.ComponentProps<'div'>) =>
  React.createElement('div', {
    ref,
    className: cn(
      'flex size-6 cursor-pointer items-center justify-center rounded-[4px] text-muted-foreground transition-all duration-200 ease-in-out select-none',
      'hover:bg-accent [&:hover_.tool-icon]:text-foreground',
      '[&.active]:text-primary [&.active_.tool-icon]:text-primary',
      '[&_.tool-icon]:size-[14px] [&_.tool-icon]:text-muted-foreground',
      className
    ),
    ...props
  })

ToolWrapper.displayName = 'ToolWrapper'
