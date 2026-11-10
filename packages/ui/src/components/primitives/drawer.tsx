import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as React from 'react'
import { Drawer as DrawerPrimitive } from 'vaul'

import { cn } from '@cherrystudio/ui/lib/utils'

const NonModalDirectionContext = React.createContext<'top' | 'bottom' | 'left' | 'right' | null>(null)

function Drawer({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  if (props.modal === false) {
    return (
      <NonModalDirectionContext value={props.direction ?? 'bottom'}>
        <DialogPrimitive.Root
          open={props.open}
          defaultOpen={props.defaultOpen}
          onOpenChange={props.onOpenChange}
          modal={false}>
          {props.children}
        </DialogPrimitive.Root>
      </NonModalDirectionContext>
    )
  }
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />
}

function DrawerTrigger({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  const Trigger = React.use(NonModalDirectionContext) ? DialogPrimitive.Trigger : DrawerPrimitive.Trigger
  return <Trigger data-slot="drawer-trigger" {...props} />
}

function DrawerPortal({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  const Portal = React.use(NonModalDirectionContext) ? DialogPrimitive.Portal : DrawerPrimitive.Portal
  return <Portal data-slot="drawer-portal" {...props} />
}

function DrawerClose({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  const Close = React.use(NonModalDirectionContext) ? DialogPrimitive.Close : DrawerPrimitive.Close
  return <Close data-slot="drawer-close" {...props} />
}

function DrawerOverlay({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  const direction = React.use(NonModalDirectionContext)
  if (direction) return null
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        className
      )}
      {...props}
    />
  )
}

function DrawerContent({
  className,
  children,
  showOverlay = true,
  portalContainer,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content> & {
  showOverlay?: boolean
  portalContainer?: HTMLElement | null
}) {
  const direction = React.use(NonModalDirectionContext)
  const Content = direction ? DialogPrimitive.Content : DrawerPrimitive.Content
  return (
    <DrawerPortal data-slot="drawer-portal" container={portalContainer}>
      {showOverlay && <DrawerOverlay />}
      <Content
        {...(direction ? { 'data-vaul-drawer-direction': direction } : {})}
        data-slot="drawer-content"
        className={cn(
          'group/drawer-content fixed z-50 flex h-auto flex-col bg-background',
          direction && 'data-[state=closed]:animate-out data-[state=open]:animate-in motion-reduce:animate-none',
          direction === 'left' && 'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
          direction === 'right' && 'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
          direction === 'top' && 'data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
          direction === 'bottom' && 'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
          'data-[vaul-drawer-direction=top]:inset-x-0 data-[vaul-drawer-direction=top]:top-0 data-[vaul-drawer-direction=top]:mb-24 data-[vaul-drawer-direction=top]:max-h-[80vh] data-[vaul-drawer-direction=top]:rounded-b-lg data-[vaul-drawer-direction=top]:border-b',
          'data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:bottom-0 data-[vaul-drawer-direction=bottom]:mt-24 data-[vaul-drawer-direction=bottom]:max-h-[80vh] data-[vaul-drawer-direction=bottom]:rounded-t-lg data-[vaul-drawer-direction=bottom]:border-t',
          'data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:w-3/4 data-[vaul-drawer-direction=right]:border-l data-[vaul-drawer-direction=right]:sm:max-w-sm',
          'data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:left-0 data-[vaul-drawer-direction=left]:w-3/4 data-[vaul-drawer-direction=left]:border-r data-[vaul-drawer-direction=left]:sm:max-w-sm',
          className
        )}
        {...props}>
        <div className="mx-auto mt-4 hidden h-2 w-25 shrink-0 rounded-full bg-muted group-data-[vaul-drawer-direction=bottom]/drawer-content:block" />
        {children}
      </Content>
    </DrawerPortal>
  )
}

function DrawerHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        'flex flex-col gap-0.5 p-4 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-center group-data-[vaul-drawer-direction=top]/drawer-content:text-center md:gap-1.5 md:text-left',
        className
      )}
      {...props}
    />
  )
}

function DrawerFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="drawer-footer" className={cn('mt-auto flex flex-col gap-2 p-4', className)} {...props} />
}

function DrawerTitle({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn('font-semibold text-foreground', className)}
      {...props}
    />
  )
}

function DrawerDescription({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger
}
