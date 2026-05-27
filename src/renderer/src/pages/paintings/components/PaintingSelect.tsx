import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import React from 'react'

type SelectValueType = string | number

export interface PaintingSelectOption {
  label: ReactNode
  value: SelectValueType
  disabled?: boolean
}

export interface PaintingSelectOptionGroup {
  label: ReactNode
  options: PaintingSelectOption[]
}

export type PaintingSelectOptionItem = PaintingSelectOption | PaintingSelectOptionGroup

interface PaintingSelectOptionProps extends Omit<PaintingSelectOption, 'label'> {
  label?: ReactNode
  children?: ReactNode
}

interface PaintingSelectOptGroupProps {
  label: ReactNode
  children?: ReactNode
}

interface NormalizedOption extends PaintingSelectOption {
  key: string
}

interface NormalizedGroup {
  label?: ReactNode
  options: NormalizedOption[]
}

export interface PaintingSelectProps<TValue extends SelectValueType = string> {
  value?: TValue
  defaultValue?: TValue
  options?: PaintingSelectOptionItem[]
  children?: ReactNode
  onChange?: (value: TValue) => void
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  className?: string
  contentClassName?: string
  style?: CSSProperties
}

const PaintingSelectOption: React.FC<PaintingSelectOptionProps> = () => null
const PaintingSelectOptGroup: React.FC<PaintingSelectOptGroupProps> = () => null

function isOptionElement(child: ReactNode): child is ReactElement<PaintingSelectOptionProps> {
  return React.isValidElement(child) && child.type === PaintingSelectOption
}

function isOptGroupElement(child: ReactNode): child is ReactElement<PaintingSelectOptGroupProps> {
  return React.isValidElement(child) && child.type === PaintingSelectOptGroup
}

function normalizeOption(option: PaintingSelectOption): NormalizedOption {
  return {
    ...option,
    key: String(option.value)
  }
}

function isOptionGroup(option: PaintingSelectOptionItem): option is PaintingSelectOptionGroup {
  return 'options' in option
}

function normalizeChildren(children: ReactNode): NormalizedGroup[] {
  const groups: NormalizedGroup[] = []
  const rootOptions: NormalizedOption[] = []

  React.Children.toArray(children).forEach((child) => {
    if (isOptionElement(child)) {
      const { value, disabled, children: optionChildren, label } = child.props
      rootOptions.push(normalizeOption({ value, disabled, label: optionChildren ?? label ?? value }))
      return
    }

    if (isOptGroupElement(child)) {
      const options: NormalizedOption[] = []
      React.Children.toArray(child.props.children).forEach((groupChild) => {
        if (!isOptionElement(groupChild)) {
          return
        }
        const { value, disabled, children: optionChildren, label } = groupChild.props
        options.push(normalizeOption({ value, disabled, label: optionChildren ?? label ?? value }))
      })
      groups.push({ label: child.props.label, options })
    }
  })

  if (rootOptions.length > 0) {
    groups.unshift({ options: rootOptions })
  }

  return groups
}

function normalizeOptions(options: PaintingSelectOptionItem[] | undefined, children: ReactNode): NormalizedGroup[] {
  if (options) {
    const groups: NormalizedGroup[] = []
    const rootOptions: NormalizedOption[] = []

    options.forEach((option) => {
      if (isOptionGroup(option)) {
        groups.push({ label: option.label, options: option.options.map(normalizeOption) })
        return
      }

      rootOptions.push(normalizeOption(option))
    })

    if (rootOptions.length > 0) {
      groups.unshift({ options: rootOptions })
    }

    return groups
  }

  return normalizeChildren(children)
}

function findOriginalValue(groups: NormalizedGroup[], key: string) {
  return groups.flatMap((group) => group.options).find((option) => option.key === key)?.value ?? key
}

function findSelectedLabel(groups: NormalizedGroup[], value: SelectValueType | undefined) {
  if (value === undefined) {
    return undefined
  }

  return groups.flatMap((group) => group.options).find((option) => option.key === String(value))?.label
}

function PaintingSelect<TValue extends SelectValueType = string>({
  value,
  defaultValue,
  options,
  children,
  onChange,
  placeholder,
  disabled,
  loading,
  className,
  contentClassName,
  style
}: PaintingSelectProps<TValue>) {
  const groups = normalizeOptions(options, children)
  const selectedLabel = findSelectedLabel(groups, value ?? defaultValue)

  return (
    <Select
      value={value === undefined ? undefined : String(value)}
      defaultValue={defaultValue === undefined ? undefined : String(defaultValue)}
      disabled={disabled || loading}
      onValueChange={(nextValue) => onChange?.(findOriginalValue(groups, nextValue) as TValue)}>
      <SelectTrigger className={cn('w-full', className)} style={style}>
        <SelectValue placeholder={placeholder}>{selectedLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent className={contentClassName}>
        {groups.map((group, groupIndex) => (
          <SelectGroup key={groupIndex}>
            {group.label && <SelectLabel>{group.label}</SelectLabel>}
            {group.options.map((option) => (
              <SelectItem key={option.key} value={option.key} disabled={option.disabled}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

PaintingSelect.Option = PaintingSelectOption
PaintingSelect.OptGroup = PaintingSelectOptGroup

export default PaintingSelect
