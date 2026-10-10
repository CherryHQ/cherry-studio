'use client'

import * as React from 'react'

import { cn } from '@cherrystudio/ui/lib/utils'

interface DividerProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical'
}

/**
 * A simple divider component for visual separation.
 * For more complex use cases with text, use DividerWithText instead.
 */
const Divider: React.FC<DividerProps> = ({ className, orientation = 'horizontal', ...props }) => {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        'shrink-0 border-0',
        orientation === 'horizontal'
          ? 'my-2.5 h-px w-full border-t-[0.5px] border-solid border-(--color-border)'
          : 'mx-2.5 h-full w-px border-l-[0.5px] border-solid border-(--color-border)',
        className
      )}
      {...props}
    />
  )
}

export { Divider, type DividerProps }
