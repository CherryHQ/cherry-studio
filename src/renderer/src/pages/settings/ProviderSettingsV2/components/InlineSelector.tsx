import { Button, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import { Check, ChevronsUpDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo } from 'react'

import { providerSettingsTypography } from './ProviderSettingsPrimitives'

export interface InlineSelectorOption<V = string> {
  label: string | ReactNode
  value: V
  disabled?: boolean
}

interface InlineSelectorProps<V = string> {
  value?: V
  onChange: (value: V) => void
  options: InlineSelectorOption<V>[]
  placeholder?: string
  disabled?: boolean
  className?: string
}

export default function InlineSelector<V extends string | number>({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className
}: InlineSelectorProps<V>) {
  const selected = useMemo(() => options.find((option) => option.value === value), [options, value])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn(
            'h-auto min-h-0 rounded-3xs border border-border/40 bg-transparent px-2.5 py-1 font-semibold text-foreground shadow-none hover:bg-accent/40',
            providerSettingsTypography.body,
            className
          )}>
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>{selected?.label ?? placeholder}</span>
          <ChevronsUpDown size={14} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-1">
        <MenuList>
          {options.map((option) => (
            <MenuItem
              key={String(option.value)}
              className={cn('rounded-3xs px-2 py-[5px] hover:bg-accent/40', providerSettingsTypography.menu)}
              label={typeof option.label === 'string' ? option.label : String(option.value)}
              icon={<Check size={14} className={cn(option.value === value ? 'opacity-100' : 'opacity-0')} />}
              disabled={option.disabled}
              onClick={() => onChange(option.value)}>
              {typeof option.label === 'string' ? undefined : option.label}
            </MenuItem>
          ))}
        </MenuList>
      </PopoverContent>
    </Popover>
  )
}
