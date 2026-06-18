import { cn } from '@cherrystudio/ui/lib/utils'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

// ---------------------------------------------------------------------------
// MenuItem
// ---------------------------------------------------------------------------

const menuItemVariants = cva(
  cn(
    'group relative flex w-full items-center gap-2.5 rounded-lg font-normal',
    'border border-transparent',
    'transition-all duration-150',
    'outline-none select-none',
    'focus-visible:ring-ring/50 focus-visible:ring-[3px]',
    'disabled:pointer-events-none disabled:opacity-40',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0'
  ),
  {
    variants: {
      variant: {
        default: cn(
          'text-foreground',
          'hover:bg-accent',
          'data-[active=true]:bg-accent',
          'data-[active=true]:border-transparent'
        ),
        ghost: cn('text-foreground', 'hover:bg-accent', 'data-[active=true]:bg-accent')
      },
      size: {
        default: 'px-2.5 py-1.5 text-sm',
        sm: 'px-2.5 py-1 text-xs'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

type MenuItemProps = React.ComponentProps<'button'> &
  VariantProps<typeof menuItemVariants> & {
    icon?: React.ReactNode
    label: string
    labelClassName?: string
    description?: React.ReactNode
    descriptionLines?: number
    descriptionClassName?: string
    active?: boolean
    suffix?: React.ReactNode
    asChild?: boolean
  }

function MenuItem({
  className,
  variant,
  size,
  icon,
  label,
  labelClassName,
  description,
  descriptionLines,
  descriptionClassName,
  active,
  disabled,
  suffix,
  asChild,
  ref,
  ...props
}: MenuItemProps) {
  const Comp = asChild ? Slot : 'button'
  const descriptionStyle =
    descriptionLines && descriptionLines > 0
      ? ({
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: descriptionLines
        } as React.CSSProperties)
      : undefined

  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : 'button'}
      data-active={active || undefined}
      data-slot="menu-item"
      disabled={disabled || undefined}
      className={cn(menuItemVariants({ variant, size }), className)}
      {...props}>
      {icon && <span className="flex shrink-0 items-center justify-center">{icon}</span>}
      <span className={cn('min-w-0  text-start', suffix && 'flex-1')}>
        <span className={cn('block truncate', labelClassName)}>{label}</span>
        {description && (
          <span
            className={cn(
              'mt-0.5 block text-[10px] text-muted-foreground',
              descriptionLines ? 'overflow-hidden' : '',
              descriptionClassName
            )}
            style={descriptionStyle}>
            {description}
          </span>
        )}
      </span>
      {suffix && <span className="ms-auto flex shrink-0 items-center">{suffix}</span>}
    </Comp>
  )
}

MenuItem.displayName = 'MenuItem'

// ---------------------------------------------------------------------------
// MenuList
// ---------------------------------------------------------------------------

type MenuListProps = React.ComponentProps<'div'>

function MenuList({ className, ref, ...props }: MenuListProps) {
  return <div ref={ref} data-slot="menu-list" className={cn('flex flex-col gap-1', className)} {...props} />
}

MenuList.displayName = 'MenuList'

// ---------------------------------------------------------------------------
// MenuDivider
// ---------------------------------------------------------------------------

type MenuDividerProps = React.ComponentProps<'div'>

function MenuDivider({ className, ref, ...props }: MenuDividerProps) {
  return (
    <div
      ref={ref}
      data-slot="menu-divider"
      role="separator"
      className={cn('my-1 h-px bg-border', className)}
      {...props}
    />
  )
}

MenuDivider.displayName = 'MenuDivider'

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { MenuDivider, MenuItem, menuItemVariants, MenuList }
export type { MenuDividerProps, MenuItemProps, MenuListProps }
