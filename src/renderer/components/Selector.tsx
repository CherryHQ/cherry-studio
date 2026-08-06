import {
  Combobox,
  type ComboboxOption,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { CSSProperties, ReactNode } from 'react'
import { isValidElement, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface SelectorOption<V = string | number> {
  label: string | ReactNode
  value: V
  type?: 'group'
  options?: SelectorOption<V>[]
  disabled?: boolean
}

interface BaseSelectorProps<V = string | number> {
  options: SelectorOption<V>[]
  placeholder?: string
  placement?: 'topLeft' | 'topCenter' | 'topRight' | 'bottomLeft' | 'bottomCenter' | 'bottomRight' | 'top' | 'bottom'
  style?: CSSProperties
  /** 字体大小 */
  size?: number
  /** 是否禁用 */
  disabled?: boolean
}

interface SingleSelectorProps<V> extends BaseSelectorProps<V> {
  multiple?: false
  value?: V
  onChange: (value: V) => void
}

interface MultipleSelectorProps<V> extends BaseSelectorProps<V> {
  multiple: true
  value?: V[]
  onChange: (value: V[]) => void
}

export type SelectorProps<V = string | number> = SingleSelectorProps<V> | MultipleSelectorProps<V>

const placementMap: Record<
  NonNullable<BaseSelectorProps['placement']>,
  {
    side: 'top' | 'bottom'
    align: 'start' | 'center' | 'end'
  }
> = {
  topLeft: { side: 'top', align: 'start' },
  topCenter: { side: 'top', align: 'center' },
  topRight: { side: 'top', align: 'end' },
  bottomLeft: { side: 'bottom', align: 'start' },
  bottomCenter: { side: 'bottom', align: 'center' },
  bottomRight: { side: 'bottom', align: 'end' },
  top: { side: 'top', align: 'center' },
  bottom: { side: 'bottom', align: 'center' }
}

const getNodeText = (node: ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map(getNodeText).join('')
  }

  if (isValidElement<{ children?: ReactNode; 'aria-hidden'?: boolean | 'true' }>(node)) {
    if (node.props['aria-hidden']) {
      return ''
    }
    return getNodeText(node.props.children)
  }

  return ''
}

const isGroupOption = <V extends string | number>(option: SelectorOption<V>) =>
  option.type === 'group' || Boolean(option.options?.length)

interface FlatSelectorOption<V extends string | number> {
  encodedValue: string
  option: SelectorOption<V>
}

const flattenOptions = <V extends string | number>(options: SelectorOption<V>[]): FlatSelectorOption<V>[] =>
  options.flatMap((option) =>
    isGroupOption(option) ? flattenOptions(option.options ?? []) : [{ encodedValue: String(option.value), option }]
  )

const Selector = <V extends string | number>({
  options,
  value,
  onChange,
  placement = 'bottomRight',
  size,
  placeholder,
  style,
  disabled = false,
  multiple = false
}: SelectorProps<V>) => {
  const { t } = useTranslation()
  const popoverPlacement = placementMap[placement]
  const flatOptions = useMemo(() => flattenOptions(options), [options])
  const optionTextLabels = useMemo(
    () => [...new Set(flatOptions.map(({ option }) => getNodeText(option.label)).filter(Boolean))],
    [flatOptions]
  )
  const selectedValues = multiple ? ((value as V[] | undefined) ?? []) : value !== undefined ? [value as V] : []
  const selectedOptions = flatOptions.filter(({ option }) =>
    selectedValues.some((selectedValue) => String(selectedValue) === String(option.value))
  )
  const displayValue =
    selectedOptions.length === 0
      ? placeholder
      : selectedOptions.length === 1
        ? selectedOptions[0].option.label
        : t('common.selectedItems', { count: selectedOptions.length })
  const accessibleLabel = getNodeText(displayValue)
  const triggerStyle = { fontSize: size, ...style }

  if (multiple) {
    const comboboxOptions: ComboboxOption<{ option: SelectorOption<V> }>[] = flatOptions.map(
      ({ encodedValue, option }) => ({
        value: encodedValue,
        label: getNodeText(option.label) || encodedValue,
        disabled: option.disabled,
        option
      })
    )

    return (
      <Combobox
        multiple
        searchable={false}
        size="sm"
        options={comboboxOptions}
        value={selectedValues.map(String)}
        disabled={disabled}
        aria-label={accessibleLabel || undefined}
        placeholder={placeholder}
        popoverAlign={popoverPlacement.align}
        popoverSide={popoverPlacement.side}
        triggerStyle={triggerStyle}
        renderOption={(item) => item.option.label}
        renderValue={() => (
          <span className={cn('min-w-0 flex-1 truncate text-left', !displayValue && 'text-muted-foreground')}>
            {displayValue}
          </span>
        )}
        onChange={(nextValue) => {
          const encodedValues = Array.isArray(nextValue) ? nextValue : [nextValue]
          const nextOptions = encodedValues.flatMap((encodedValue) => {
            const match = flatOptions.find((option) => option.encodedValue === encodedValue)
            return match ? [match.option.value] : []
          })
          ;(onChange as MultipleSelectorProps<V>['onChange'])(nextOptions)
        }}
      />
    )
  }

  const renderOptions = (items: SelectorOption<V>[]): ReactNode =>
    items.map((option) => {
      if (isGroupOption(option)) {
        return (
          <SelectGroup key={String(option.value)}>
            <SelectLabel>{option.label}</SelectLabel>
            {renderOptions(option.options ?? [])}
          </SelectGroup>
        )
      }

      return (
        <SelectItem key={String(option.value)} value={String(option.value)} disabled={option.disabled}>
          {option.label}
        </SelectItem>
      )
    })

  return (
    <Select
      value={value === undefined ? '' : String(value)}
      onValueChange={(nextValue) => {
        const match = flatOptions.find((option) => option.encodedValue === nextValue)
        if (match) {
          ;(onChange as SingleSelectorProps<V>['onChange'])(match.option.value)
        }
      }}>
      <SelectTrigger
        size="sm"
        disabled={disabled}
        aria-label={accessibleLabel || undefined}
        style={triggerStyle}
        className="min-w-0">
        <span className="grid min-w-0 items-center text-left">
          <span className="col-start-1 row-start-1 min-w-0 truncate">
            <SelectValue placeholder={placeholder} />
          </span>
          {optionTextLabels.map((text) => (
            <span
              key={text}
              aria-hidden="true"
              className="invisible col-start-1 row-start-1 min-w-0 overflow-hidden whitespace-nowrap pr-4">
              {text}
            </span>
          ))}
        </span>
      </SelectTrigger>
      <SelectContent
        align={popoverPlacement.align}
        side={popoverPlacement.side}
        className="max-h-80 w-(--radix-select-trigger-width)">
        {renderOptions(options)}
      </SelectContent>
    </Select>
  )
}

export default Selector
