'use client'

import { cn } from '@cherrystudio/ui/lib/utils'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import * as React from 'react'

import { usePortalContainer } from './portal-container'

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root {...props} />
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-ui="part:popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  forceMount,
  portalContainer,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  portalContainer?: React.ComponentProps<typeof PopoverPrimitive.Portal>['container']
}) {
  const defaultPortalContainer = usePortalContainer()

  return (
    <PopoverPrimitive.Portal forceMount={forceMount} container={portalContainer ?? defaultPortalContainer ?? undefined}>
      <PopoverPrimitive.Content
        data-ui="part:popover-content"
        align={align}
        sideOffset={sideOffset}
        forceMount={forceMount}
        className={cn(
          // no-drag punches the popup's area out of any titlebar drag region it overlaps,
          // so hover/click reach the items instead of the window-drag hit test (Electron).
          'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-[80] w-72 origin-(--radix-popover-content-transform-origin) rounded-lg border-[0.5px] p-4 shadow-lg outline-hidden [-webkit-app-region:no-drag]',
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-ui="part:popover-anchor" {...props} />
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger }
