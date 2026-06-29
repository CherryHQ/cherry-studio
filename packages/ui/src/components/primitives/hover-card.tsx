'use client'

import { cn } from '@cherrystudio/ui/lib/utils'
import * as HoverCardPrimitive from '@radix-ui/react-hover-card'
import * as React from 'react'

import { usePortalContainer } from './portal-container'

function HoverCard({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />
}

function HoverCardTrigger({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
}

function HoverCardContent({
  className,
  align = 'center',
  sideOffset = 4,
  portalContainer,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content> & {
  portalContainer?: React.ComponentProps<typeof HoverCardPrimitive.Portal>['container']
}) {
  const defaultPortalContainer = usePortalContainer()

  return (
    <HoverCardPrimitive.Portal container={portalContainer ?? defaultPortalContainer ?? undefined}>
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-[80] w-80 origin-(--radix-hover-card-content-transform-origin) rounded-lg border-[0.5px] p-4 shadow-lg outline-hidden',
          className
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardContent, HoverCardTrigger }
