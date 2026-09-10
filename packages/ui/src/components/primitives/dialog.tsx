import { cn } from '@cherrystudio/ui/lib/utils'
import { DIALOG_CLOSE_DURATION_MS } from '@cherrystudio/ui/utils'
import { composeEventHandlers } from '@radix-ui/primitive'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'
import * as React from 'react'

import { PortalContainerProvider, useDialogPortalContainer } from './portal-container'

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ container, ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  const defaultPortalContainer = useDialogPortalContainer()
  return <DialogPrimitive.Portal data-slot="dialog-portal" container={container ?? defaultPortalContainer} {...props} />
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({ className, onPointerDown, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-[80] bg-black/50',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:animation-duration-[220ms] data-[state=open]:ease-[cubic-bezier(0.16,1,0.3,1)]',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:animation-duration-[200ms] data-[state=closed]:ease-[cubic-bezier(0.4,0,1,1)]',
        'fill-mode-both motion-reduce:animate-none',
        className
      )}
      onPointerDown={composeEventHandlers(onPointerDown, (event) => event.stopPropagation(), {
        checkForDefaultPrevented: false
      })}
      {...props}
    />
  )
}

type DialogContentSize = 'sm' | 'default' | 'lg' | 'xl'
type DialogContentMotion = 'directional' | 'fade-scale'

const dialogContentSizeClass: Record<DialogContentSize, string> = {
  sm: 'sm:max-w-sm',
  default: 'sm:max-w-lg',
  lg: 'sm:max-w-xl',
  xl: 'sm:max-w-[720px]'
}

type DialogContentProps = React.ComponentProps<typeof DialogPrimitive.Content> & {
  closeLabel?: string
  closeOnOverlayClick?: boolean
  motion?: DialogContentMotion
  overlayClassName?: string
  showCloseButton?: boolean
  size?: DialogContentSize
}

/**
 * Close-animation duration (ms) of DialogContent. The literal
 * `data-[state=closed]:animation-duration-[200ms]` class below cannot be interpolated
 * (Tailwind needs to discover the whole class name), so this constant mirrors it and a
 * co-located test asserts they stay equal. Imperative host removal timing is defined
 * separately by DIALOG_UNMOUNT_DELAY_MS.
 */
export { DIALOG_CLOSE_DURATION_MS }

function DialogContent({
  className,
  children,
  closeLabel = 'Close',
  closeOnOverlayClick = true,
  showCloseButton = true,
  motion = 'directional',
  overlayClassName,
  onPointerDown,
  size = 'default',
  ref,
  ...props
}: DialogContentProps) {
  const [contentElement, setContentElement] = React.useState<HTMLDivElement | null>(null)
  const handleRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      setContentElement(node)
      if (typeof ref === 'function') {
        ref(node)
      } else if (ref) {
        ref.current = node
      }
    },
    [ref]
  )

  return (
    <DialogPortal data-slot="dialog-portal">
      {/* Keep this tree stable when async flows temporarily disable overlay dismissal. */}
      <DialogPrimitive.Close asChild>
        <DialogOverlay
          className={overlayClassName}
          onClick={(event) => {
            if (!closeOnOverlayClick) event.preventDefault()
          }}
        />
      </DialogPrimitive.Close>
      {/*
        Keep Content as a direct Portal child so Radix Presence receives its DOM ref and
        can retain it for the closed-state animation. Nested overlays still inherit the
        content element as their portal target from the provider inside Content.

        The closed-state animation duration below must equal DIALOG_CLOSE_DURATION_MS
        (above); a test enforces it. Imperative host removal timing is defined separately
        by DIALOG_UNMOUNT_DELAY_MS.
      */}
      <DialogPrimitive.Content
        ref={handleRef}
        data-slot="dialog-content"
        className={cn(
          // This physical offset and translation center the surface independently of writing direction.
          // no-drag punches the dialog's area out of any titlebar drag region it overlaps,
          // so the close button stays clickable when the dialog reaches max height (Electron).
          'bg-card text-card-foreground fixed top-[50%] left-[50%] z-[80] grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-3xl border-0 p-6 shadow-xl [-webkit-app-region:no-drag]',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-99 data-[state=open]:animation-duration-[260ms] data-[state=open]:ease-[cubic-bezier(0.16,1,0.3,1)]',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-99 data-[state=closed]:animation-duration-[200ms] data-[state=closed]:ease-[cubic-bezier(0.4,0,1,1)]',
          motion === 'directional' &&
            'data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-bottom-4',
          'fill-mode-both motion-reduce:animate-none',
          dialogContentSizeClass[size],
          className
        )}
        onPointerDown={composeEventHandlers(onPointerDown, (event) => event.stopPropagation(), {
          checkForDefaultPrevented: false
        })}
        {...props}>
        <PortalContainerProvider container={contentElement}>
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              className="data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-md opacity-70 transition-opacity hover:opacity-100 focus:outline-hidden focus-visible:bg-accent focus-visible:opacity-100 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
              <XIcon />
              <span className="sr-only">{closeLabel}</span>
            </DialogPrimitive.Close>
          )}
        </PortalContainerProvider>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-2 text-center sm:text-start', className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger
}
