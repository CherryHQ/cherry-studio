import { cn } from '@cherrystudio/ui/lib/utils'
import * as React from 'react'

type MenuContainerProps = React.ComponentPropsWithoutRef<'div'> & {
  $visible: boolean
}

export const MenuContainer = ({
  ref,
  $visible,
  className,
  ...props
}: MenuContainerProps & { ref?: React.RefObject<HTMLDivElement | null> }) =>
  React.createElement('div', {
    ref,
    className: cn(
      'fixed z-[2000] max-h-[400px] min-w-[280px] max-w-[320px] overflow-hidden rounded-md border border-border bg-background shadow-lg',
      'max-[480px]:min-w-[240px] max-[480px]:max-w-[280px]',
      $visible
        ? 'fade-in-0 slide-in-from-bottom-2 animate-in duration-150'
        : 'fade-out-0 slide-out-to-bottom-2 pointer-events-none animate-out duration-150',
      className
    ),
    ...props
  })
MenuContainer.displayName = 'MenuContainer'

export const MenuGroupTitle = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { ref?: React.RefObject<HTMLDivElement | null> }) =>
  React.createElement('div', {
    ref,
    className: cn(
      'border-border px-4 pt-2 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-[0.5px]',
      '[&:not(:first-child)]:mt-2 [&:not(:first-child)]:border-t [&:not(:first-child)]:pt-3',
      className
    ),
    ...props
  })
MenuGroupTitle.displayName = 'MenuGroupTitle'

export const MenuGroup = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { ref?: React.RefObject<HTMLDivElement | null> }) =>
  React.createElement('div', {
    ref,
    className: cn('border-border py-1 [&:not(:last-child)]:border-b', className),
    ...props
  })
MenuGroup.displayName = 'MenuGroup'

type MenuItemProps = React.ComponentPropsWithoutRef<'button'> & {
  $danger?: boolean
}

export const MenuItem = ({
  ref,
  $danger,
  className,
  ...props
}: MenuItemProps & { ref?: React.RefObject<HTMLButtonElement | null> }) =>
  React.createElement('button', {
    ref,
    className: cn(
      'flex w-full cursor-pointer items-center gap-3 border-none bg-transparent px-4 py-2 text-left text-sm transition-colors',
      'focus:bg-primary/10 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
      $danger ? 'text-destructive hover:bg-destructive/10 hover:text-destructive' : 'text-foreground hover:bg-accent',
      className
    ),
    ...props
  })
MenuItem.displayName = 'MenuItem'

export const MenuItemIcon = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { ref?: React.RefObject<HTMLDivElement | null> }) =>
  React.createElement('div', {
    ref,
    className: cn('flex size-4 shrink-0 items-center justify-center', className),
    ...props
  })
MenuItemIcon.displayName = 'MenuItemIcon'

export const MenuItemLabel = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'span'> & { ref?: React.RefObject<HTMLSpanElement | null> }) =>
  React.createElement('span', {
    ref,
    className: cn('flex-1 font-normal', className),
    ...props
  })
MenuItemLabel.displayName = 'MenuItemLabel'

export const MenuItemShortcut = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'span'> & { ref?: React.RefObject<HTMLSpanElement | null> }) =>
  React.createElement('span', {
    ref,
    className: cn('ml-auto font-mono text-muted-foreground text-xs', className),
    ...props
  })
MenuItemShortcut.displayName = 'MenuItemShortcut'

type DragHandleContainerProps = React.ComponentPropsWithoutRef<'div'> & {
  $visible: boolean
}

export const DragHandleContainer = ({
  ref,
  $visible,
  className,
  ...props
}: DragHandleContainerProps & { ref?: React.RefObject<HTMLDivElement | null> }) =>
  React.createElement('div', {
    ref,
    className: cn(
      '-translate-y-1/2 absolute top-1/2 left-[-60px] z-10 flex items-center gap-1 p-0.5 transition-opacity duration-150',
      $visible ? 'opacity-100' : 'opacity-0',
      className
    ),
    ...props
  })
DragHandleContainer.displayName = 'DragHandleContainer'

const handleButtonClassName =
  'flex size-6 cursor-pointer items-center justify-center rounded border-none bg-background p-0 text-muted-foreground transition-colors duration-150 hover:bg-accent focus:bg-primary/10 focus:outline-none'

export const PlusButton = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'button'> & { ref?: React.RefObject<HTMLButtonElement | null> }) =>
  React.createElement('button', {
    ref,
    className: cn(handleButtonClassName, className),
    ...props
  })
PlusButton.displayName = 'PlusButton'

export const DragHandleButton = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { ref?: React.RefObject<HTMLDivElement | null> }) =>
  React.createElement('div', {
    ref,
    className: cn(
      handleButtonClassName,
      'cursor-grab active:cursor-grabbing [&[draggable=true]]:select-none',
      className
    ),
    ...props
  })
DragHandleButton.displayName = 'DragHandleButton'

export const LoadingIndicator = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { ref?: React.RefObject<HTMLDivElement | null> }) =>
  React.createElement('div', {
    ref,
    className: cn('flex items-center justify-center p-4 text-muted-foreground text-sm', className),
    ...props
  })
LoadingIndicator.displayName = 'LoadingIndicator'

export const ErrorMessage = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { ref?: React.RefObject<HTMLDivElement | null> }) =>
  React.createElement('div', {
    ref,
    className: cn('m-2 rounded bg-destructive/10 px-4 py-3 text-center text-destructive text-sm', className),
    ...props
  })
ErrorMessage.displayName = 'ErrorMessage'

export const EmptyState = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { ref?: React.RefObject<HTMLDivElement | null> }) =>
  React.createElement('div', {
    ref,
    className: cn('px-4 py-6 text-center text-muted-foreground text-sm', className),
    ...props
  })
EmptyState.displayName = 'EmptyState'

export const MenuDivider = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'hr'> & { ref?: React.RefObject<HTMLHRElement | null> }) =>
  React.createElement('hr', {
    ref,
    className: cn('my-1 border-0 border-border border-t', className),
    ...props
  })
MenuDivider.displayName = 'MenuDivider'
