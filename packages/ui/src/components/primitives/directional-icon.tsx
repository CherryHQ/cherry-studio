import { cn } from '@cherrystudio/ui/lib/utils'
import { Slot } from '@radix-ui/react-slot'
import * as React from 'react'

import { useDirection } from './direction'

function DirectionalIcon({ className, ...props }: React.ComponentProps<typeof Slot>) {
  const direction = useDirection()

  return (
    <Slot data-slot="directional-icon" className={cn(direction === 'rtl' && '-scale-x-100', className)} {...props} />
  )
}

export { DirectionalIcon }
