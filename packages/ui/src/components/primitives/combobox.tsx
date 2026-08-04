'use client'

import { Button } from '@cherrystudio/ui/components/primitives/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@cherrystudio/ui/components/primitives/command'
import { Input } from '@cherrystudio/ui/components/primitives/input'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@cherrystudio/ui/components/primitives/popover'
import { cn } from '@cherrystudio/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { Check, ChevronDown, X } from 'lucide-react'
import * as React from 'react'

import Scrollbar from '../composites/scrollbar'

// ==================== Variants ====================

const comboboxTriggerVariants = cva(
  cn(
    'inline-flex items-center justify-between rounded-lg text-sm transition-colors outline-none font-normal',
    'border border-input bg-transparent hover:border-border-strong hover:bg-transparent dark:bg-transparent',
    'focus-visible:border-ring focus-visible:bg-transparent',
    'text-foreground'
  ),
  {
    variants: {
      state: {
        default: 'aria-expanded:bg-transparent',
        error: 'border-destructive! aria-expanded:ring-1 aria-expanded:ring-destructive/20',
        disabled: 'opacity-50 cursor-not-allowed pointer-events-none'
      },
      size: {
        sm: 'px-2 text-xs gap-1',
        default: 'px-2.5 gap-2',
        lg: 'px-4 gap-2'
      }
    },
    defaultVariants: {
      state: 'default',
      size: 'default'
    }
  }
)

const comboboxItemVariants = cva(
  'relative flex items-center gap-2 rounded-lg px-2 py-1 text-sm cursor-pointer transition-colors outline-none select-none',
  {
    variants: {
      state: {
        default: 'hover:bg-accent data-[selected=true]:bg-accent',
        selected: 'bg-control-accent/10 text-control-accent',
        disabled: 'opacity-50 cursor-not-allowed pointer-events-none'
      }
    },
    defaultVariants: {
      state: 'default'
    }
  }
)

const comboboxInputSizeClasses = {
  sm: 'h-7 px-2 text-xs',
  default: 'h-7 px-2.5 text-sm',
  lg: 'h-9 px-4 text-sm'
}

// ==================== Types ====================

export type ComboboxOption<TExtra extends object = Record<never, never>> = {
  value: string
  label: string
  disabled?: boolean
  icon?: React.ReactNode
  description?: string
} & TExtra

export type ComboboxSearchPlacement = 'content' | 'trigger'

export interface ComboboxProps<TExtra extends object = Record<never, never>>
  extends Omit<VariantProps<typeof comboboxTriggerVariants>, 'state'> {
  // Data source
  options: ComboboxOption<TExtra>[]
  value?: string | string[]
  defaultValue?: string | string[]
  onChange?: (value: string | string[]) => void

  // Mode
  multiple?: boolean

  // Custom rendering
  renderOption?: (option: ComboboxOption<TExtra>) => React.ReactNode
  renderValue?: (value: string | string[], options: ComboboxOption<TExtra>[]) => React.ReactNode

  // Search
  searchable?: boolean
  searchPlacement?: ComboboxSearchPlacement
  searchPlaceholder?: string
  emptyText?: string
  /** Aria-label for the remove tag button. Receives the selected option label. */
  getRemoveTagAriaLabel?: (optionLabel: string) => string
  onSearch?: (search: string) => void
  filterOption?: (option: ComboboxOption<TExtra>, search: string) => boolean

  // State
  error?: boolean
  disabled?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onFocusOutside?: React.ComponentProps<typeof PopoverContent>['onFocusOutside']

  // Styling
  placeholder?: string
  className?: string
  popoverClassName?: string
  popoverAlign?: React.ComponentProps<typeof PopoverContent>['align']
  portalContainer?: React.ComponentProps<typeof PopoverContent>['portalContainer']
  triggerStyle?: React.CSSProperties
  width?: string | number

  // Other
  name?: string
  'aria-label'?: string
}

// ==================== Component ====================

export function Combobox<TExtra extends object = Record<never, never>>({
  options,
  value: controlledValue,
  defaultValue,
  onChange,
  multiple = false,
  renderOption,
  renderValue,
  searchable = true,
  searchPlacement = 'content',
  searchPlaceholder = 'Search...',
  emptyText = 'No results found.',
  getRemoveTagAriaLabel = (optionLabel) => `Remove ${optionLabel}`,
  onSearch,
  filterOption,
  error = false,
  disabled = false,
  open: controlledOpen,
  onOpenChange,
  onFocusOutside,
  placeholder = 'Please Select',
  className,
  popoverClassName,
  popoverAlign,
  portalContainer,
  triggerStyle,
  width,
  size,
  name,
  'aria-label': ariaLabel
}: ComboboxProps<TExtra>) {
  // ==================== State ====================
  const [internalOpen, setInternalOpen] = React.useState(false)
  const [internalValue, setInternalValue] = React.useState<string | string[]>(defaultValue ?? (multiple ? [] : ''))
  const [triggerSearch, setTriggerSearch] = React.useState('')
  const [contentSearch, setContentSearch] = React.useState('')
  const [activeValue, setActiveValue] = React.useState('')
  const triggerInputRef = React.useRef<HTMLInputElement>(null)

  const open = controlledOpen ?? internalOpen
  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (onOpenChange) {
        onOpenChange(nextOpen)
      } else {
        setInternalOpen(nextOpen)
      }
    },
    [onOpenChange]
  )

  const value = controlledValue ?? internalValue
  const setValue = (newValue: string | string[]) => {
    if (controlledValue === undefined) {
      setInternalValue(newValue)
    }
    onChange?.(newValue)
  }

  const selectedOption = !multiple ? options.find((opt) => opt.value === value) : undefined

  // Seed cmdk's active (highlighted) descendant to the current selection each
  // time the list opens. Without this, cmdk defaults the highlight to the first
  // option, making it look selected even when another option is the real value.
  React.useEffect(() => {
    if (open && !multiple && typeof value === 'string') {
      setActiveValue(value)
    }
  }, [open, multiple, value])

  const triggerSearchEnabled = searchable && searchPlacement === 'trigger' && !multiple
  const contentSearchEnabled = searchable && !triggerSearchEnabled
  const manualFilterEnabled = triggerSearchEnabled || (contentSearchEnabled && Boolean(filterOption))
  const activeSearch = triggerSearchEnabled ? triggerSearch : contentSearch
  const normalizedSearch = activeSearch.trim().toLowerCase()
  const visibleOptions = React.useMemo(() => {
    if (!manualFilterEnabled || !normalizedSearch) {
      return options
    }

    return options.filter((option) => {
      if (filterOption) {
        return filterOption(option, activeSearch)
      }

      return [option.label, option.value, option.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    })
  }, [activeSearch, filterOption, manualFilterEnabled, normalizedSearch, options])

  // ==================== Handlers ====================

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      if (triggerSearch || contentSearch) {
        onSearch?.('')
      }
      setTriggerSearch('')
      setContentSearch('')
      return
    }

    if (triggerSearchEnabled) {
      setTriggerSearch('')
    }
  }

  const handleSelect = (selectedValue: string) => {
    if (multiple) {
      const currentValues = (value as string[]) || []
      const newValues = currentValues.includes(selectedValue)
        ? currentValues.filter((v) => v !== selectedValue)
        : [...currentValues, selectedValue]
      setValue(newValues)
    } else {
      if (selectedValue !== value) {
        setValue(selectedValue)
      }
      handleOpenChange(false)
    }
  }

  const handleRemoveTag = (tagValue: string, e: React.MouseEvent | React.KeyboardEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (multiple) {
      const currentValues = (value as string[]) || []
      setValue(currentValues.filter((v) => v !== tagValue))
    }
  }

  const handleRemoveTagKeyDown = (tagValue: string, e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      handleRemoveTag(tagValue, e)
    }
  }

  const isSelected = (optionValue: string): boolean => {
    if (multiple) {
      return ((value as string[]) || []).includes(optionValue)
    }
    return value === optionValue
  }

  const handleTriggerInputFocus = (event: React.FocusEvent<HTMLInputElement>) => {
    if (!triggerSearchEnabled) {
      return
    }

    if (!open) {
      handleOpenChange(true)
    }
    event.currentTarget.select()
  }

  const handleTriggerInputMouseDown = () => {
    if (!triggerSearchEnabled || open) {
      return
    }

    handleOpenChange(true)
  }

  const handleTriggerInputClick = (event: React.MouseEvent<HTMLInputElement>) => {
    if (!triggerSearchEnabled) {
      return
    }

    event.preventDefault()
    event.currentTarget.focus()
    if (!open) {
      handleOpenChange(true)
    }
  }

  const handleTriggerInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextSearch = event.target.value
    setTriggerSearch(nextSearch)
    onSearch?.(nextSearch)
    if (!open) {
      setOpen(true)
    }
  }

  const handleTriggerInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!triggerSearchEnabled) {
      return
    }

    if (event.key === 'Escape') {
      handleOpenChange(false)
      return
    }

    if (event.key === 'Enter') {
      if (!normalizedSearch) {
        event.preventDefault()
        handleOpenChange(false)
        return
      }

      const firstEnabledOption = visibleOptions.find((option) => !option.disabled)
      if (firstEnabledOption) {
        event.preventDefault()
        handleSelect(firstEnabledOption.value)
      }
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) {
        handleOpenChange(true)
      }
    }
  }

  const handleContentSearchChange = (nextSearch: string) => {
    setContentSearch(nextSearch)
    onSearch?.(nextSearch)
  }

  // ==================== Render Helpers ====================

  const renderTriggerContent = () => {
    if (renderValue) {
      return renderValue(value, options)
    }

    if (multiple) {
      const selectedValues = (value as string[]) || []
      if (selectedValues.length === 0) {
        return <span className="text-muted-foreground">{placeholder}</span>
      }

      const selectedOptions = options.filter((opt) => selectedValues.includes(opt.value))

      return (
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {selectedOptions.map((option) => (
            <span
              key={option.value}
              className={cn(
                'bg-control-accent/10 text-control-accent',
                'gap-1 px-2 py-0.5',
                'inline-flex items-center rounded',
                'text-xs'
              )}>
              {option.label}
              <button
                type="button"
                aria-label={getRemoveTagAriaLabel(option.label)}
                className="inline-flex size-3 cursor-pointer items-center justify-center opacity-70 hover:text-foreground hover:opacity-100"
                onClick={(e) => handleRemoveTag(option.value, e)}
                onKeyDown={(e) => handleRemoveTagKeyDown(option.value, e)}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )
    }

    const selectedOption = options.find((opt) => opt.value === value)
    if (selectedOption) {
      return (
        <div className="flex items-center gap-2 flex-1 min-w-0 truncate">
          {selectedOption.icon}
          <span className="truncate">{selectedOption.label}</span>
        </div>
      )
    }

    return <span className="text-muted-foreground">{placeholder}</span>
  }

  const renderTriggerInput = () => {
    const triggerInputValue = open ? triggerSearch : (selectedOption?.label ?? '')
    const triggerInputPlaceholder = open ? (selectedOption?.label ?? placeholder) : placeholder
    const inputSize = size ?? 'default'

    return (
      <PopoverAnchor asChild>
        <div className="relative" style={{ width: triggerWidth }}>
          <PopoverTrigger asChild>
            <Input
              ref={triggerInputRef}
              type="text"
              value={triggerInputValue}
              placeholder={triggerInputPlaceholder}
              disabled={disabled}
              aria-label={ariaLabel}
              aria-expanded={open}
              aria-invalid={error}
              role="combobox"
              autoComplete="off"
              spellCheck={false}
              onFocus={handleTriggerInputFocus}
              onMouseDown={handleTriggerInputMouseDown}
              onClick={handleTriggerInputClick}
              onChange={handleTriggerInputChange}
              onKeyDown={handleTriggerInputKeyDown}
              style={triggerStyle}
              className={cn(
                'w-full rounded-lg bg-transparent pr-8 shadow-none transition-colors hover:border-border-strong hover:bg-transparent aria-expanded:bg-transparent dark:bg-transparent',
                error && 'border-destructive!',
                disabled && 'cursor-not-allowed opacity-50',
                comboboxInputSizeClasses[inputSize],
                className
              )}
            />
          </PopoverTrigger>
          <ChevronDown
            className={cn(
              'pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 shrink-0 text-foreground-tertiary transition-transform',
              open && 'rotate-180'
            )}
          />
        </div>
      </PopoverAnchor>
    )
  }

  const renderMultiTrigger = () => {
    const inputSize = size ?? 'default'

    return (
      <PopoverTrigger asChild>
        <div
          role="combobox"
          tabIndex={disabled ? -1 : 0}
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-invalid={error}
          aria-disabled={disabled}
          style={{ width: triggerWidth, ...triggerStyle }}
          className={cn(
            comboboxTriggerVariants({ state, size }),
            comboboxInputSizeClasses[inputSize],
            'cursor-pointer',
            className
          )}
          onKeyDown={(event) => {
            if (disabled) return
            if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
              event.preventDefault()
              handleOpenChange(true)
            }
          }}>
          {renderTriggerContent()}
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </div>
      </PopoverTrigger>
    )
  }

  const renderOptionContent = (option: ComboboxOption<TExtra>) => (
    <>
      {renderOption ? (
        <div className="min-w-0 flex-1">{renderOption(option)}</div>
      ) : (
        <>
          {option.icon && <span className="shrink-0">{option.icon}</span>}
          <div className="min-w-0 flex-1">
            <div className="truncate">{option.label}</div>
            {option.description && <div className="truncate text-muted-foreground text-xs">{option.description}</div>}
          </div>
        </>
      )}
      {isSelected(option.value) && <Check className="size-4 shrink-0 text-control-accent" />}
    </>
  )

  // ==================== Render ====================

  const state = disabled ? 'disabled' : error ? 'error' : 'default'
  const triggerWidth = width ? (typeof width === 'number' ? `${width}px` : width) : undefined
  const popoverWidth =
    typeof triggerWidth === 'string' && triggerWidth.trim().endsWith('%')
      ? 'var(--radix-popover-trigger-width)'
      : triggerWidth

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {triggerSearchEnabled ? (
        renderTriggerInput()
      ) : multiple ? (
        renderMultiTrigger()
      ) : (
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size={size}
            disabled={disabled}
            style={{ width: triggerWidth, ...triggerStyle }}
            className={cn(comboboxTriggerVariants({ state, size }), className)}
            aria-label={ariaLabel}
            aria-expanded={open}
            aria-invalid={error}>
            {renderTriggerContent()}
            <ChevronDown className="size-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
      )}
      <PopoverContent
        className={cn(
          'w-(--radix-popover-trigger-width) rounded-lg border border-border-subtle bg-popover/70 p-0 backdrop-blur-xl supports-[backdrop-filter]:bg-popover/60',
          popoverClassName
        )}
        align={popoverAlign}
        portalContainer={portalContainer}
        style={{ width: popoverWidth }}
        onFocusOutside={onFocusOutside}
        onOpenAutoFocus={(event) => {
          if (!triggerSearchEnabled) {
            return
          }

          event.preventDefault()
          triggerInputRef.current?.focus()
        }}>
        <Command
          shouldFilter={!manualFilterEnabled}
          {...(!multiple ? { value: activeValue, onValueChange: setActiveValue } : {})}>
          {contentSearchEnabled && (
            <CommandInput
              placeholder={searchPlaceholder}
              className="h-9 rounded-none"
              wrapperClassName="m-1 rounded-lg border border-border-strong px-2.5"
              onValueChange={handleContentSearchChange}
            />
          )}
          <CommandList asChild>
            <Scrollbar className="[scrollbar-gutter:auto] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden data-[scrolling=true]:[scrollbar-gutter:stable] data-[scrolling=true]:![scrollbar-width:auto] data-[scrolling=true]:[&::-webkit-scrollbar]:!block">
              {manualFilterEnabled ? (
                visibleOptions.length === 0 ? (
                  <div className="py-6 text-center text-muted-foreground text-sm">{emptyText}</div>
                ) : (
                  <CommandGroup>
                    {visibleOptions.map((option) => (
                      <CommandItem
                        key={option.value}
                        value={option.value || option.label}
                        disabled={option.disabled}
                        onSelect={() => handleSelect(option.value)}
                        className={cn(comboboxItemVariants({ state: option.disabled ? 'disabled' : 'default' }))}>
                        {renderOptionContent(option)}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )
              ) : (
                <>
                  <CommandEmpty>{emptyText}</CommandEmpty>
                  <CommandGroup>
                    {options.map((option) => (
                      <CommandItem
                        key={option.value}
                        value={option.value}
                        disabled={option.disabled}
                        onSelect={() => handleSelect(option.value)}
                        className={cn(comboboxItemVariants({ state: option.disabled ? 'disabled' : 'default' }))}>
                        {renderOptionContent(option)}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </Scrollbar>
          </CommandList>
        </Command>
      </PopoverContent>
      {name && <input type="hidden" name={name} value={multiple ? JSON.stringify(value) : (value as string)} />}
    </Popover>
  )
}
