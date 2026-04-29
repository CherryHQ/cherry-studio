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

// ==================== Variants ====================

const comboboxTriggerVariants = cva(
  cn(
    'inline-flex items-center justify-between rounded-md border-1 text-sm transition-colors outline-none font-normal',
    'bg-zinc-50 dark:bg-zinc-900',
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
        sm: 'px-2 text-xs gap-1',
        default: 'px-3 gap-2',
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
  'relative flex items-center gap-2 px-2 py-1.5 text-sm rounded-md cursor-pointer transition-colors outline-none select-none',
  {
    variants: {
      state: {
        default: 'hover:bg-accent data-[selected=true]:bg-accent',
        selected: 'bg-success/10 text-success-foreground',
        disabled: 'opacity-50 cursor-not-allowed pointer-events-none'
      }
    },
    defaultVariants: {
      state: 'default'
    }
  }
)

const comboboxInputSizeClasses = {
  sm: 'h-8 px-2 text-xs',
  default: 'h-9 px-3 text-sm',
  lg: 'h-10 px-4 text-sm'
}

// ==================== Types ====================

export interface ComboboxOption {
  value: string
  label: string
  disabled?: boolean
  icon?: React.ReactNode
  description?: string
  [key: string]: any
}

export type ComboboxSearchPlacement = 'content' | 'trigger'

export interface ComboboxProps extends Omit<VariantProps<typeof comboboxTriggerVariants>, 'state'> {
  // Data source
  options: ComboboxOption[]
  value?: string | string[]
  defaultValue?: string | string[]
  onChange?: (value: string | string[]) => void

  // Mode
  multiple?: boolean

  // Custom rendering
  renderOption?: (option: ComboboxOption) => React.ReactNode
  renderValue?: (value: string | string[], options: ComboboxOption[]) => React.ReactNode

  // Search
  searchable?: boolean
  searchPlacement?: ComboboxSearchPlacement
  searchPlaceholder?: string
  emptyText?: string
  onSearch?: (search: string) => void
  filterOption?: (option: ComboboxOption, search: string) => boolean

  // State
  error?: boolean
  disabled?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void

  // Styling
  placeholder?: string
  className?: string
  popoverClassName?: string
  triggerStyle?: React.CSSProperties
  width?: string | number

  // Other
  name?: string
}

// ==================== Component ====================

export function Combobox({
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
  onSearch,
  filterOption,
  error = false,
  disabled = false,
  open: controlledOpen,
  onOpenChange,
  placeholder = 'Please Select',
  className,
  popoverClassName,
  triggerStyle,
  width,
  size,
  name
}: ComboboxProps) {
  // ==================== State ====================
  const [internalOpen, setInternalOpen] = React.useState(false)
  const [internalValue, setInternalValue] = React.useState<string | string[]>(defaultValue ?? (multiple ? [] : ''))
  const [triggerSearch, setTriggerSearch] = React.useState('')
  const [contentSearch, setContentSearch] = React.useState('')
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

  const handleRemoveTag = (tagValue: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (multiple) {
      const currentValues = (value as string[]) || []
      setValue(currentValues.filter((v) => v !== tagValue))
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
        <div className="flex flex-wrap gap-1 flex-1 min-w-0">
          {selectedOptions.map((option) => (
            <span
              key={option.value}
              className={cn(
                'bg-primary/10 text-primary',
                'gap-1 px-2 py-0.5',
                'inline-flex items-center rounded',
                'text-success-foreground text-xs'
              )}>
              {option.label}
              <X
                className="size-3 cursor-pointer hover:text-success"
                onClick={(e) => handleRemoveTag(option.value, e)}
              />
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
                'w-full rounded-md border-1 bg-zinc-50 pr-8 shadow-none transition-colors dark:bg-zinc-900',
                'focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20',
                error && 'border-destructive! focus-visible:ring-red-600/20',
                disabled && 'cursor-not-allowed opacity-50',
                comboboxInputSizeClasses[inputSize],
                className
              )}
            />
          </PopoverTrigger>
          <ChevronDown
            className={cn(
              'pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 shrink-0 opacity-50 transition-transform',
              open && 'rotate-180'
            )}
          />
        </div>
      </PopoverAnchor>
    )
  }

  const renderOptionContent = (option: ComboboxOption) => {
    if (renderOption) {
      return renderOption(option)
    }

    return (
      <>
        {option.icon && <span className="shrink-0">{option.icon}</span>}
        <div className="flex-1 min-w-0">
          <div className="truncate">{option.label}</div>
          {option.description && <div className="text-xs text-muted-foreground truncate">{option.description}</div>}
        </div>
        {isSelected(option.value) && <Check className="size-4 shrink-0 text-success" />}
      </>
    )
  }

  // ==================== Render ====================

  const state = disabled ? 'disabled' : error ? 'error' : 'default'
  const triggerWidth = width ? (typeof width === 'number' ? `${width}px` : width) : undefined

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {triggerSearchEnabled ? (
        renderTriggerInput()
      ) : (
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size={size}
            disabled={disabled}
            style={{ width: triggerWidth, ...triggerStyle }}
            className={cn(comboboxTriggerVariants({ state, size }), className)}
            aria-expanded={open}
            aria-invalid={error}>
            {renderTriggerContent()}
            <ChevronDown className="size-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
      )}
      <PopoverContent
        className={cn('p-0 rounded-md', popoverClassName)}
        style={{ width: triggerWidth }}
        onOpenAutoFocus={(event) => {
          if (!triggerSearchEnabled) {
            return
          }

          event.preventDefault()
          triggerInputRef.current?.focus()
        }}>
        <Command shouldFilter={!manualFilterEnabled}>
          {contentSearchEnabled && (
            <CommandInput
              placeholder={searchPlaceholder}
              className="h-9 rounded-none"
              onValueChange={handleContentSearchChange}
            />
          )}
          <CommandList>
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
          </CommandList>
        </Command>
      </PopoverContent>
      {name && <input type="hidden" name={name} value={multiple ? JSON.stringify(value) : (value as string)} />}
    </Popover>
  )
}
