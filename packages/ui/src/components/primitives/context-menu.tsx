'use client'

import { cn } from '@cherrystudio/ui/lib/utils'
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import { cva, type VariantProps } from 'class-variance-authority'
import { Check, ChevronRight } from 'lucide-react'
import * as React from 'react'

/* ─── Style variants ──────────────────────────────────────────────────────── */

const menuContentStyles = cn(
  'bg-popover text-popover-foreground z-50 min-w-[8rem] overflow-hidden rounded-xs p-2',
  'shadow-[0px_2px_5px_rgba(0,0,0,0.04),0px_10px_10px_rgba(0,0,0,0.04),0px_22px_13px_rgba(0,0,0,0.02),0px_39px_16px_rgba(0,0,0,0.01),inset_0px_-1px_1.3px_rgba(0,0,0,0.2)]',
  'data-[state=open]:animate-in data-[state=closed]:animate-out',
  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
  'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95'
)

const menuItemVariants = cva(
  cn(
    'relative flex cursor-default select-none items-center gap-2 rounded-2xs px-2 py-[9px] text-sm outline-hidden transition-colors',
    'focus:bg-menu-item-hover',
    'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0"
  ),
  {
    variants: {
      variant: {
        default: '',
        destructive: 'text-destructive focus:bg-destructive/10 focus:text-destructive'
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

function ContextMenu({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
}

function ContextMenuGroup({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Group>) {
  return <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
}

function ContextMenuPortal({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Portal>) {
  return <ContextMenuPrimitive.Portal data-slot="context-menu-portal" {...props} />
}

function ContextMenuSub({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />
}

function ContextMenuRadioGroup({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.RadioGroup>) {
  return <ContextMenuPrimitive.RadioGroup data-slot="context-menu-radio-group" {...props} />
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
      className={cn(menuItemVariants({ inset }), 'justify-between data-[state=open]:bg-menu-item-hover', className)}
      {...props}>
      <span className="flex items-center gap-2">{children}</span>
      <ChevronRight className="size-4 text-foreground-secondary" />
    </ContextMenuPrimitive.SubTrigger>
  )
}

function ContextMenuSubContent({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.SubContent
      data-slot="context-menu-sub-content"
      className={cn(
        menuContentStyles,
        'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
        'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        className
      )}
      {...props}
    />
  )
}

function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        className={cn(menuContentStyles, className)}
        {...props}
      />
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
      className={cn(menuItemVariants({ variant, inset }), 'justify-between', className)}
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
          <Check className="size-4" />
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
          <Check className="size-4" />
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
      className={cn('px-2 py-[9px] text-sm text-foreground-secondary', inset && 'pl-8', className)}
      {...props}
    />
  )
}

function ContextMenuSeparator({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn('-mx-2 my-0 border-b border-border', className)}
      {...props}
    />
  )
}

function ContextMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn('ml-auto text-xs tracking-widest text-foreground-secondary', className)}
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
      <span className={cn('flex items-center gap-2', className)}>
        {icon && <span className="size-4 shrink-0">{icon}</span>}
        <span className="flex-1">{children}</span>
      </span>
      <span className="flex items-center gap-1">
        {badge}
        {shortcut && <ContextMenuShortcut>{shortcut}</ContextMenuShortcut>}
        {hasSubmenu && <ChevronRight className="size-4 text-foreground-secondary" />}
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
