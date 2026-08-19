import { cn } from '@cherrystudio/ui/lib/utils'
import * as React from 'react'

import { useDirection } from './direction'

function DirectionalIcon({ className, children, ...props }: React.ComponentProps<'span'>) {
  const direction = useDirection()

  return (
    <span
      {...props}
      aria-hidden={props['aria-hidden'] ?? true}
      data-slot="directional-icon"
      data-direction={direction}
      className={cn('inline-flex shrink-0 data-[direction=rtl]:[transform:scaleX(-1)]', className)}>
      {children}
    </span>
  )
}

export { DirectionalIcon }
