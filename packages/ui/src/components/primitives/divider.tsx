'use client'

import { cn } from '@cherrystudio/ui/lib/utils'
import * as React from 'react'

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
          ? 'h-px w-full my-2.5 border-t-[0.5px] border-solid border-(--color-border)'
          : 'w-px h-full mx-2.5 border-l-[0.5px] border-solid border-(--color-border)',
        className
      )}
      {...props}
    />
  )
}

export { Divider, type DividerProps }
