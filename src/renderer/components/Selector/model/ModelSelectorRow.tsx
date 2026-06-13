import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { ComponentPropsWithoutRef, KeyboardEvent, MouseEvent, ReactNode } from 'react'

export const MODEL_SELECTOR_ROW_CLASS =
  'group relative flex w-full items-center gap-1 rounded-[10px] px-2 py-1.5 text-left text-xs transition-colors'

export const MODEL_SELECTOR_ROW_ACTION_BUTTON_CLASS =
  'flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 shadow-none transition hover:bg-accent hover:text-accent-foreground hover:opacity-100! group-hover:opacity-60 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'

export const MODEL_SELECTOR_ROW_PINNED_ACTION_BUTTON_CLASS = '-rotate-45 opacity-100'
export const MODEL_SELECTOR_ROW_ACTIVE_ACTION_COLOR_CLASS = 'text-foreground!'
export const MODEL_SELECTOR_ROW_CHECKBOX_CLASS =
  'border-muted-foreground/40 hover:bg-muted/70 data-[state=checked]:border-muted-foreground data-[state=checked]:bg-muted-foreground data-[state=checked]:text-background focus-visible:ring-muted-foreground/20'

type DataAttributes = {
  [key: `data-${string}`]: string | number | boolean | undefined
}

type ModelSelectorRowProps = {
  selected: boolean
  focused?: boolean
  disabled?: boolean
  showSelectedIndicator?: boolean
  checkbox?: ReactNode
  leading?: ReactNode
  children: ReactNode
  trailing?: ReactNode
  actions?: ReactNode
  onSelect?: () => void
  rootProps?: ComponentPropsWithoutRef<'div'> & DataAttributes
  optionProps?: ComponentPropsWithoutRef<'div'> & DataAttributes
}

export function ModelSelectorRow({
  selected,
  focused = false,
  disabled = false,
  showSelectedIndicator = false,
  checkbox,
  leading,
  children,
  trailing,
  actions,
  onSelect,
  rootProps,
  optionProps
}: ModelSelectorRowProps) {
  const { className: rootClassName, ...restRootProps } = rootProps ?? {}
  const { className: optionClassName, onClick: onOptionClick, ...restOptionProps } = optionProps ?? {}

  return (
    <div
      {...restRootProps}
      className={cn(
        MODEL_SELECTOR_ROW_CLASS,
        selected && 'bg-accent/70 text-foreground',
        !selected && !disabled && focused && 'bg-accent/60',
        !selected && !disabled && !focused && 'text-foreground hover:bg-accent/60',
        disabled && 'cursor-not-allowed text-muted-foreground opacity-50',
        rootClassName
      )}
      data-model-selector-row>
      {showSelectedIndicator ? (
        <span
          aria-hidden="true"
          className="-translate-y-1/2 absolute top-1/2 left-0 block h-[60%] w-0.75 rounded-full bg-muted-foreground/60"
        />
      ) : null}
      <div
        {...restOptionProps}
        role={optionProps?.role ?? 'option'}
        aria-selected={optionProps?.['aria-selected'] ?? selected}
        aria-disabled={optionProps?.['aria-disabled'] ?? (disabled || undefined)}
        tabIndex={optionProps?.tabIndex ?? -1}
        className={cn(
          'flex min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden outline-none',
          disabled && 'cursor-not-allowed',
          optionClassName
        )}
        onClick={(event) => {
          onOptionClick?.(event)
          if (event.defaultPrevented || disabled) {
            return
          }
          onSelect?.()
        }}>
        {checkbox}
        {leading}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
        {trailing}
      </div>
      {actions ? <div className="ml-0 flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  )
}

type ModelSelectorRowActionButtonProps = ComponentPropsWithoutRef<'button'> & {
  pinned?: boolean
  selected?: boolean
}

export function ModelSelectorRowActionButton({
  pinned = false,
  selected = false,
  className,
  onClick,
  onKeyDown,
  children,
  type = 'button',
  ...props
}: ModelSelectorRowActionButtonProps) {
  return (
    <Button
      {...props}
      type={type}
      variant="ghost"
      size="icon-sm"
      className={cn(
        MODEL_SELECTOR_ROW_ACTION_BUTTON_CLASS,
        (pinned || selected) && MODEL_SELECTOR_ROW_ACTIVE_ACTION_COLOR_CLASS,
        pinned && MODEL_SELECTOR_ROW_PINNED_ACTION_BUTTON_CLASS,
        className
      )}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation()
        onClick?.(event)
      }}
      onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.stopPropagation()
        }
        onKeyDown?.(event)
      }}>
      {children}
    </Button>
  )
}
