import { cn } from '@cherrystudio/ui/lib/utils'
import { Slot } from '@radix-ui/react-slot'
import * as React from 'react'

function DirectionalIcon({ className, ...props }: React.ComponentProps<typeof Slot>) {
  return <Slot data-slot="directional-icon" className={cn('rtl:-scale-x-100', className)} {...props} />
}

export { DirectionalIcon }
