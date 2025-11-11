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
import { Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui/components/primitives/popover'
import { cn } from '@cherrystudio/ui/utils/index'
import { cva, type VariantProps } from 'class-variance-authority'
import { Check, ChevronDown, X } from 'lucide-react'
import * as React from 'react'

// ==================== Variants ====================

const comboboxTriggerVariants = cva(
  cn(
    'inline-flex items-center justify-between rounded-2xs border-1 text-sm transition-colors outline-none font-normal',
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
  'relative flex items-center gap-2 px-2 py-1.5 text-sm rounded-2xs cursor-pointer transition-colors outline-none select-none',
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

// ==================== Types ====================

export interface ComboboxOption {
  value: string
  label: string
  disabled?: boolean
  icon?: React.ReactNode
  description?: string
  [key: string]: any
}

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
  searchPlaceholder?: string
  emptyText?: string
  onSearch?: (search: string) => void

  // State
  error?: boolean
  disabled?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void

  // Styling
  placeholder?: string
  className?: string
  popoverClassName?: string
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
  searchPlaceholder = 'Search...',
  emptyText = 'No results found.',
  onSearch,
  error = false,
  disabled = false,
  open: controlledOpen,
  onOpenChange,
  placeholder = 'Please Select',
  className,
  popoverClassName,
  width,
  size,
  name
}: ComboboxProps) {
  // ==================== State ====================
  const [internalOpen, setInternalOpen] = React.useState(false)
  const [internalValue, setInternalValue] = React.useState<string | string[]>(defaultValue ?? (multiple ? [] : ''))

  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen

  const value = controlledValue ?? internalValue
  const setValue = (newValue: string | string[]) => {
    if (controlledValue === undefined) {
      setInternalValue(newValue)
    }
    onChange?.(newValue)
  }

  // ==================== Handlers ====================

  const handleSelect = (selectedValue: string) => {
    if (multiple) {
      const currentValues = (value as string[]) || []
      const newValues = currentValues.includes(selectedValue)
        ? currentValues.filter((v) => v !== selectedValue)
        : [...currentValues, selectedValue]
      setValue(newValues)
    } else {
      setValue(selectedValue === value ? '' : selectedValue)
      setOpen(false)
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size={size}
          disabled={disabled}
          style={{ width: triggerWidth }}
          className={cn(comboboxTriggerVariants({ state, size }), className)}
          aria-expanded={open}
          aria-invalid={error}>
          {renderTriggerContent()}
          <ChevronDown className="size-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('p-0 rounded-2xs', popoverClassName)} style={{ width: triggerWidth }}>
        <Command>
          {searchable && (
            <CommandInput placeholder={searchPlaceholder} className="h-9 rounded-none" onValueChange={onSearch} />
          )}
          <CommandList>
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
          </CommandList>
        </Command>
      </PopoverContent>
      {name && <input type="hidden" name={name} value={multiple ? JSON.stringify(value) : (value as string)} />}
    </Popover>
  )
}
