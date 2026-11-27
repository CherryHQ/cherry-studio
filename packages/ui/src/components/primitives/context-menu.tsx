'use client'

import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import { useControllableState } from '@radix-ui/react-use-controllable-state'
import { cva, type VariantProps } from 'class-variance-authority'
import { CheckIcon, ChevronRightIcon, CircleIcon } from 'lucide-react'
import * as React from 'react'

import { cn } from '@cherrystudio/ui/lib/utils'

import { Kbd } from './kbd'
import {
  KeyboardLayer,
  KeyboardLayerOpenContext,
  KeyboardLayerRoot,
  useKeyboardLayerRef,
  useKeyboardLayerState
} from './keyboard-layer'
import { usePortalContainer } from './portal-container'

/* ─── Style variants ──────────────────────────────────────────────────────── */

const menuContentStyles = cn(
  // no-drag punches the popup's area out of any titlebar drag region it overlaps,
  // so hover/click reach the items instead of the window-drag hit test (Electron).
  'z-50 max-h-(--radix-context-menu-content-available-height) min-w-[8rem] origin-(--radix-context-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md [-webkit-app-region:no-drag]',
  'data-[state=closed]:animate-out data-[state=open]:animate-in',
  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
  'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95'
)
const menuSubContentStyles = cn(
  'z-50 min-w-[8rem] origin-(--radix-context-menu-content-transform-origin) overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg [-webkit-app-region:no-drag]',
  'data-[state=closed]:animate-out data-[state=open]:animate-in',
  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
  'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95'
)

const menuItemVariants = cva(
  cn(
    'relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none',
    'focus:bg-accent focus:text-accent-foreground',
    'data-disabled:pointer-events-none data-disabled:opacity-50',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    "[&_svg:not([class*='text-'])]:text-muted-foreground"
  ),
  {
    variants: {
      variant: {
        default: '',
        // The icon selector is a descendant (`[&_svg]`), not a direct-child (`*:[svg]`) match:
        // ContextMenuItemContent wraps the icon in extra spans, so a direct-child rule never
        // reaches it and the base `text-muted-foreground` rule would win, leaving destructive
        // icons gray. Mirror the base rule's `:not([class*='text-'])` so callers can still opt out.
        destructive:
          "text-destructive focus:bg-destructive/10 focus:text-destructive dark:focus:bg-destructive/20 data-[variant=destructive]:[&_svg:not([class*='text-'])]:text-destructive!"
      },
      inset: {
        true: 'pl-8',
        false: ''
      }
    },
    defaultVariants: {
      variant: 'default',
      inset: false
    }
  }
)

/* ─── Root / trigger / content / items ────────────────────────────────────── */

type ContextMenuOpeningPointerUpGuard = {
  consumeOpeningPointerUp: () => boolean
  markOpeningPointerUp: () => void
}

const ContextMenuOpeningPointerUpGuardContext = React.createContext<ContextMenuOpeningPointerUpGuard | null>(null)

function ContextMenu({
  open: openProp,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  const [open, setOpen] = useControllableState({ prop: openProp, defaultProp: false, onChange: onOpenChange })
  const shouldStopOpeningPointerUpRef = React.useRef(false)
  const clearOpeningPointerUpListenerRef = React.useRef<(() => void) | null>(null)
  const clearOpeningPointerUpTimerRef = React.useRef<number | null>(null)
  const clearOpeningPointerUp = React.useCallback(() => {
    shouldStopOpeningPointerUpRef.current = false
    clearOpeningPointerUpListenerRef.current?.()
    clearOpeningPointerUpListenerRef.current = null
    if (clearOpeningPointerUpTimerRef.current !== null) {
      window.clearTimeout(clearOpeningPointerUpTimerRef.current)
      clearOpeningPointerUpTimerRef.current = null
    }
  }, [])
  const pointerUpGuard = React.useMemo<ContextMenuOpeningPointerUpGuard>(
    () => ({
      consumeOpeningPointerUp: () => {
        const shouldStop = shouldStopOpeningPointerUpRef.current
        clearOpeningPointerUp()
        return shouldStop
      },
      markOpeningPointerUp: () => {
        shouldStopOpeningPointerUpRef.current = true
        clearOpeningPointerUpListenerRef.current?.()
        const handleOpeningPointerUp = () => clearOpeningPointerUp()
        window.addEventListener('pointerup', handleOpeningPointerUp, { once: true })
        clearOpeningPointerUpListenerRef.current = () => {
          window.removeEventListener('pointerup', handleOpeningPointerUp)
        }
        if (clearOpeningPointerUpTimerRef.current !== null) {
          window.clearTimeout(clearOpeningPointerUpTimerRef.current)
        }
        clearOpeningPointerUpTimerRef.current = window.setTimeout(clearOpeningPointerUp, 1000)
      }
    }),
    [clearOpeningPointerUp]
  )
  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      setOpen(open)
      if (!open) clearOpeningPointerUp()
    },
    [clearOpeningPointerUp, setOpen]
  )

  React.useEffect(() => clearOpeningPointerUp, [clearOpeningPointerUp])

  return (
    <KeyboardLayerRoot open={open}>
      <ContextMenuOpeningPointerUpGuardContext value={pointerUpGuard}>
        <ContextMenuPrimitive.Root data-slot="context-menu" open={open} onOpenChange={handleOpenChange} {...props} />
      </ContextMenuOpeningPointerUpGuardContext>
    </KeyboardLayerRoot>
  )
}

function ContextMenuTrigger({
  onContextMenu,
  disabled,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  const pointerUpGuard = React.use(ContextMenuOpeningPointerUpGuardContext)

  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      disabled={disabled}
      onContextMenu={(event) => {
        if (!disabled) {
          pointerUpGuard?.markOpeningPointerUp()
        }
        onContextMenu?.(event)
      }}
      {...props}
    />
  )
}

function ContextMenuGroup({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Group>) {
  return <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
}

function ContextMenuPortal({ container, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Portal>) {
  const defaultPortalContainer = usePortalContainer()
  return (
    <ContextMenuPrimitive.Portal
      data-slot="context-menu-portal"
      container={container ?? defaultPortalContainer ?? undefined}
      {...props}
    />
  )
}

function ContextMenuSub({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  const [open, setOpen] = useControllableState({ prop: openProp, defaultProp: defaultOpen, onChange: onOpenChange })
  return (
    <KeyboardLayerRoot open={open}>
      <ContextMenuPrimitive.Sub data-slot="context-menu-sub" open={open} onOpenChange={setOpen} {...props} />
    </KeyboardLayerRoot>
  )
}

function ContextMenuRadioGroup({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.RadioGroup>) {
  return <ContextMenuPrimitive.RadioGroup data-slot="context-menu-radio-group" {...props} />
}

function stopOpeningPointerUp(event: React.PointerEvent, pointerUpGuard: ContextMenuOpeningPointerUpGuard | null) {
  const isOpeningPointerUp = pointerUpGuard?.consumeOpeningPointerUp() ?? false
  if (event.button !== 2 && !isOpeningPointerUp) return

  event.preventDefault()
  event.stopPropagation()
}

// Sub-trigger only exposes the `inset` knob — `variant` is intentionally
// excluded because a destructive submenu trigger isn't a real design state.
function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger> &
  Pick<VariantProps<typeof menuItemVariants>, 'inset'>) {
  return (
    <ContextMenuPrimitive.SubTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        menuItemVariants({ inset }),
        'data-[state=open]:bg-accent data-[state=open]:text-accent-foreground',
        className
      )}
      {...props}>
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </ContextMenuPrimitive.SubTrigger>
  )
}

function ContextMenuSubContent({
  className,
  children,
  ref: forwardedRef,
  onPointerUpCapture,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  const { element, ref } = useKeyboardLayerRef(forwardedRef)
  const open = React.use(KeyboardLayerOpenContext)
  const pointerUpGuard = React.use(ContextMenuOpeningPointerUpGuardContext)

  return (
    <ContextMenuPrimitive.SubContent
      ref={ref}
      data-slot="context-menu-sub-content"
      className={cn(
        menuSubContentStyles,
        'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
        'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        className
      )}
      onPointerUpCapture={(event) => {
        onPointerUpCapture?.(event)
        stopOpeningPointerUp(event, pointerUpGuard)
      }}
      {...props}>
      <KeyboardLayer active={open} element={element}>
        {children}
      </KeyboardLayer>
    </ContextMenuPrimitive.SubContent>
  )
}

type ContextMenuContentProps = React.ComponentProps<typeof ContextMenuPrimitive.Content> & {
  portalContainer?: React.ComponentProps<typeof ContextMenuPrimitive.Portal>['container']
}

function ContextMenuContent({
  className,
  onPointerUpCapture,
  portalContainer,
  children,
  ref: forwardedRef,
  onCloseAutoFocus,
  ...props
}: ContextMenuContentProps) {
  const { element, ref } = useKeyboardLayerRef(forwardedRef)
  const layer = useKeyboardLayerState(props.forceMount)
  const pointerUpGuard = React.use(ContextMenuOpeningPointerUpGuardContext)
  const defaultPortalContainer = usePortalContainer()

  return (
    <ContextMenuPrimitive.Portal
      forceMount={props.forceMount}
      container={portalContainer ?? defaultPortalContainer ?? undefined}>
      <ContextMenuPrimitive.Content
        ref={ref}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event)
          layer.onCloseAutoFocus()
        }}
        data-slot="context-menu-content"
        className={cn(
          menuContentStyles,
          'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          className
        )}
        onPointerUpCapture={(event) => {
          onPointerUpCapture?.(event)
          stopOpeningPointerUp(event, pointerUpGuard)
        }}
        {...props}>
        <KeyboardLayer
          releaseAfterFocusRestore={layer.releaseAfterFocusRestore}
          active={layer.active}
          element={element}>
          {children}
        </KeyboardLayer>
      </ContextMenuPrimitive.Content>
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  inset,
  variant,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & VariantProps<typeof menuItemVariants>) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(menuItemVariants({ variant, inset }), className)}
      {...props}
    />
  )
}

function ContextMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      className={cn(menuItemVariants({ inset: true }), 'pr-2', className)}
      checked={checked}
      {...props}>
      <span className="pointer-events-none absolute left-2 flex size-4 items-center justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  )
}

function ContextMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioItem>) {
  return (
    <ContextMenuPrimitive.RadioItem
      data-slot="context-menu-radio-item"
      className={cn(menuItemVariants({ inset: true }), 'pr-2', className)}
      {...props}>
      <span className="pointer-events-none absolute left-2 flex size-4 items-center justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  )
}

/* ─── Decorative ──────────────────────────────────────────────────────────── */

function ContextMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.Label
      data-slot="context-menu-label"
      className={cn('px-2 py-1.5 text-sm font-medium', inset && 'pl-8', className)}
      {...props}
    />
  )
}

function ContextMenuSeparator({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}

function ContextMenuShortcut({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <Kbd
      data-slot="context-menu-shortcut"
      className={cn('ml-auto shrink-0 bg-muted px-1.5 py-0.5 whitespace-nowrap text-muted-foreground', className)}
      {...props}
    />
  )
}

/* ─── ContextMenuItemContent (icon + label + shortcut/submenu chevron) ────── */

type ContextMenuItemContentBase = {
  icon?: React.ReactNode
  children: React.ReactNode
  badge?: React.ReactNode
  className?: string
}

// Leaf items can carry a keyboard shortcut hint.
type ContextMenuItemContentLeaf = ContextMenuItemContentBase & {
  shortcut?: string
  hasSubmenu?: never
}

// Submenu rows render a chevron and must not also display a shortcut.
type ContextMenuItemContentSubmenu = ContextMenuItemContentBase & {
  hasSubmenu: true
  shortcut?: never
}

type ContextMenuItemContentProps = ContextMenuItemContentLeaf | ContextMenuItemContentSubmenu

/**
 * Convenience component for consistent menu-item content layout: icon + label
 * plus an optional trailing badge and either a keyboard shortcut OR a submenu
 * chevron (the two are mutually exclusive — see the discriminated union above).
 */
function ContextMenuItemContent(props: ContextMenuItemContentProps) {
  const { icon, children, badge, className } = props
  const shortcut = 'shortcut' in props ? props.shortcut : undefined
  const hasSubmenu = 'hasSubmenu' in props ? props.hasSubmenu : false
  return (
    <>
      <span className={cn('flex min-w-0 flex-1 items-center gap-2', className)}>
        {icon && <span className="size-4 shrink-0">{icon}</span>}
        <span className="min-w-0 flex-1 truncate">{children}</span>
      </span>
      <span className="ml-auto flex items-center gap-1">
        {badge}
        {shortcut && <ContextMenuShortcut>{shortcut}</ContextMenuShortcut>}
        {hasSubmenu && <ChevronRightIcon className="size-4 text-muted-foreground" />}
      </span>
    </>
  )
}

export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuItemContent,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  menuItemVariants
}
