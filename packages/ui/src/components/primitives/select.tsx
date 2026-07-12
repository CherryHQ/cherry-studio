import { cn } from '@cherrystudio/ui/lib/utils'
import * as SelectPrimitive from '@radix-ui/react-select'
import { cva, type VariantProps } from 'class-variance-authority'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import * as React from 'react'

import { usePortalContainer } from './portal-container'

type SelectContextValue = {
  contentElement: HTMLElement | null
  open: boolean
  setContentElement: (element: HTMLElement | null) => void
  setOpen: (open: boolean) => void
  setTriggerElement: (element: HTMLElement | null) => void
  triggerElement: HTMLElement | null
}

const SelectContext = React.createContext<SelectContextValue | null>(null)

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') {
    ref(value)
  } else if (ref) {
    ref.current = value
  }
}

const selectTriggerVariants = cva(
  cn(
    'inline-flex items-center justify-between rounded-md border-1 text-sm transition-colors outline-none font-normal',
    'bg-transparent dark:bg-input/30',
    'text-foreground'
  ),
  {
    variants: {
      state: {
        default: 'border-border aria-expanded:border-primary aria-expanded:ring-3 aria-expanded:ring-primary/20',
        error: 'border border-destructive! aria-expanded:ring-3 aria-expanded:ring-red-600/20',
        disabled: 'opacity-50 cursor-not-allowed pointer-events-none'
      },
      size: {
        sm: 'px-3 gap-2 h-8',
        default: 'px-3 gap-2 h-9'
      }
    },
    defaultVariants: {
      state: 'default',
      size: 'default'
    }
  }
)

function Select({
  defaultOpen,
  onOpenChange,
  open: openProp,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const [contentElement, setContentElement] = React.useState<HTMLElement | null>(null)
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false)
  const [triggerElement, setTriggerElement] = React.useState<HTMLElement | null>(null)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : internalOpen

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) setInternalOpen(nextOpen)
      onOpenChange?.(nextOpen)
    },
    [isControlled, onOpenChange]
  )

  const contextValue = React.useMemo(
    () => ({ contentElement, open, setContentElement, setOpen, setTriggerElement, triggerElement }),
    [contentElement, open, setOpen, triggerElement]
  )

  return (
    <SelectContext value={contextValue}>
      <SelectPrimitive.Root data-slot="select" open={open} onOpenChange={setOpen} {...props} />
    </SelectContext>
  )
}

function SelectGroup({ ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  ref,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> &
  Omit<VariantProps<typeof selectTriggerVariants>, 'state'> & {
    size?: 'sm' | 'default'
  }) {
  const selectContext = React.use(SelectContext)
  const state = props.disabled ? 'disabled' : props['aria-invalid'] ? 'error' : 'default'
  const handleRef = React.useCallback(
    (node: HTMLButtonElement | null) => {
      selectContext?.setTriggerElement(node)
      assignRef(ref, node)
    },
    [ref, selectContext]
  )

  return (
    <SelectPrimitive.Trigger
      ref={handleRef}
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        selectTriggerVariants({ state, size }),
        "data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground w-fit whitespace-nowrap *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}>
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = 'popper',
  align = 'center',
  portalContainer,
  ref,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & {
  portalContainer?: React.ComponentProps<typeof SelectPrimitive.Portal>['container']
}) {
  const defaultPortalContainer = usePortalContainer()
  const selectContext = React.use(SelectContext)
  const resolvedPortalContainer = portalContainer ?? defaultPortalContainer ?? undefined
  const handleRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      selectContext?.setContentElement(node)
      assignRef(ref, node)
    },
    [ref, selectContext]
  )

  React.useEffect(() => {
    const portalElement = resolvedPortalContainer instanceof HTMLElement ? resolvedPortalContainer : null
    if (!selectContext?.open || !portalElement) return

    const ownerDocument = portalElement.ownerDocument
    const ownerWindow = ownerDocument.defaultView ?? window
    const previousPointerEvents = portalElement.style.getPropertyValue('pointer-events')
    const previousPointerEventsPriority = portalElement.style.getPropertyPriority('pointer-events')

    const keepPortalContainerInteractive = () => {
      if (portalElement.style.pointerEvents !== 'auto') {
        portalElement.style.setProperty('pointer-events', 'auto', 'important')
      }
    }

    keepPortalContainerInteractive()

    const pointerEventsObserver = new ownerWindow.MutationObserver(keepPortalContainerInteractive)
    pointerEventsObserver.observe(portalElement, { attributes: true, attributeFilter: ['style'] })

    const closeForInsidePortalPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return
      if (selectContext.contentElement?.contains(event.target)) return
      if (selectContext.triggerElement?.contains(event.target)) return
      if (!portalElement.contains(event.target)) return

      selectContext.setOpen(false)
    }

    ownerDocument.addEventListener('pointerdown', closeForInsidePortalPointerDown, true)

    return () => {
      pointerEventsObserver.disconnect()
      ownerDocument.removeEventListener('pointerdown', closeForInsidePortalPointerDown, true)
      if (portalElement.style.pointerEvents === 'auto') {
        portalElement.style.removeProperty('pointer-events')
      }
      if (previousPointerEvents && previousPointerEvents !== 'none') {
        portalElement.style.setProperty('pointer-events', previousPointerEvents, previousPointerEventsPriority)
      }
    }
  }, [resolvedPortalContainer, selectContext])

  return (
    <SelectPrimitive.Portal container={resolvedPortalContainer}>
      <SelectPrimitive.Content
        ref={handleRef}
        data-slot="select-content"
        className={cn(
          'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-[80] max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border shadow-md',
          position === 'popper' &&
            'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
          className
        )}
        position={position}
        align={align}
        {...props}>
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            'p-1',
            position === 'popper' &&
              'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1'
          )}>
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn('text-muted-foreground px-2 py-1.5 text-xs', className)}
      {...props}
    />
  )
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground data-[state=checked]:bg-primary/10 data-[state=checked]:text-primary [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}>
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4 text-primary" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('bg-border pointer-events-none -mx-1 my-1 h-px', className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn('flex cursor-default items-center justify-center py-1', className)}
      {...props}>
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn('flex cursor-default items-center justify-center py-1', className)}
      {...props}>
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue
}
