import { Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { Check, ChevronsUpDown } from 'lucide-react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { isValidElement, useMemo, useState } from 'react'
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

const isSameValue = <V extends string | number>(left: V, right: V) => left === right || String(left) === String(right)

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

const Selector = <V extends string | number>({
  options,
  value,
  onChange = () => {},
  placement = 'bottomRight',
  size = 13,
  placeholder,
  style,
  disabled = false,
  multiple = false
}: SelectorProps<V>) => {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()
  const popoverPlacement = placementMap[placement]

  const selectedValues = useMemo(() => {
    if (multiple) {
      return (value as V[]) || []
    }
    return value !== undefined ? [value as V] : []
  }, [value, multiple])

  const label = useMemo(() => {
    if (selectedValues.length > 0) {
      const findLabels = (opts: SelectorOption<V>[]): (string | ReactNode)[] => {
        const labels: (string | ReactNode)[] = []
        for (const opt of opts) {
          if (selectedValues.some((v) => isSameValue(v, opt.value))) {
            labels.push(opt.label)
          }
          if (opt.options) {
            labels.push(...findLabels(opt.options))
          }
        }
        return labels
      }
      const labels = findLabels(options)
      if (labels.length === 0) return placeholder
      if (labels.length === 1) return labels[0]
      return t('common.selectedItems', { count: labels.length })
    }
    return placeholder
  }, [selectedValues, placeholder, options, t])

  const handleOpenChange = (nextOpen: boolean) => {
    if (disabled) return
    setOpen(nextOpen)
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setOpen((currentOpen) => !currentOpen)
    }
  }

  const handleOptionSelect = (option: SelectorOption<V>) => {
    if (disabled || option.disabled) return

    if (multiple) {
      const isSelected = selectedValues.some((selectedValue) => isSameValue(selectedValue, option.value))
      const newValues = isSelected
        ? selectedValues.filter((selectedValue) => !isSameValue(selectedValue, option.value))
        : [...selectedValues, option.value]
      ;(onChange as MultipleSelectorProps<V>['onChange'])(newValues)
      return
    }

    ;(onChange as SingleSelectorProps<V>['onChange'])(option.value)
    setOpen(false)
  }

  const renderOptions = (opts: SelectorOption<V>[], level = 0) =>
    opts.map((option) => {
      const isGroup = option.type === 'group' || Boolean(option.options?.length)
      const isSelected = selectedValues.some((selectedValue) => isSameValue(selectedValue, option.value))

      if (isGroup) {
        return (
          <div key={String(option.value)} className="py-1">
            <div className="px-2 py-1 font-medium text-muted-foreground text-xs">{option.label}</div>
            <div className={cn(level > 0 && 'pl-2')}>{renderOptions(option.options || [], level + 1)}</div>
          </div>
        )
      }

      return (
        <button
          key={String(option.value)}
          type="button"
          role="option"
          aria-selected={isSelected}
          disabled={disabled || option.disabled}
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden transition-colors',
            'hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground',
            'disabled:pointer-events-none disabled:opacity-50',
            level > 0 && 'pl-4'
          )}
          onClick={() => handleOptionSelect(option)}>
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          <span className="flex w-5 shrink-0 items-center justify-end">{isSelected && <Check size={14} />}</span>
        </button>
      )
    })

  const isPlaceholder = Boolean(placeholder && label === placeholder)
  const accessibleLabel = getNodeText(label)

  return (
    <Popover open={open && !disabled} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <div
          role="combobox"
          aria-label={accessibleLabel || undefined}
          aria-expanded={open && !disabled}
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : 0}
          className={cn(
            'inline-flex min-w-0 items-center gap-1 rounded-full px-2.5 py-1 text-left leading-none outline-hidden transition-colors',
            'hover:bg-muted focus-visible:bg-muted',
            open && !disabled && 'bg-muted',
            disabled && 'cursor-not-allowed opacity-60',
            isPlaceholder && 'text-muted-foreground'
          )}
          onKeyDown={handleTriggerKeyDown}
          style={{ fontSize: size, ...style }}>
          <span className="min-w-0 truncate">{label}</span>
          <ChevronsUpDown
            aria-hidden="true"
            size={size + 3}
            className="shrink-0 rounded bg-muted px-0 py-0.5 transition-colors"
          />
        </div>
      </PopoverTrigger>
      <PopoverContent
        align={popoverPlacement.align}
        side={popoverPlacement.side}
        className="max-h-80 w-auto min-w-(--radix-popover-trigger-width) overflow-y-auto p-1">
        <div role="listbox" aria-multiselectable={multiple || undefined}>
          {renderOptions(options)}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default Selector
