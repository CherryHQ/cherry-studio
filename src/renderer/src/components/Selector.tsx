import { Dropdown, DropdownProps } from 'antd'
import { Check, ChevronsUpDown } from 'lucide-react'
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'

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

type SelectorProps<V> = SingleSelectorProps<V> | MultipleSelectorProps<V>

const Selector = <V extends string | number>({
  options,
  value,
  onChange = () => {},
  placement = 'bottomRight',
  size = 13,
  placeholder,
  disabled = false,
  multiple = false
}: SelectorProps<V>) => {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()
  const inputRef = useRef<any>(null)

  useEffect(() => {
    if (open) {
      setTimeout(() => {
        inputRef.current?.focus()
      }, 1)
    }
  }, [open])

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
          if (selectedValues.some((v) => v == opt.value)) {
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

  const items = useMemo(() => {
    const mapOption = (option: SelectorOption<V>) => ({
      key: option.value,
      label: option.label,
      extra: <CheckIcon>{selectedValues.some((v) => v == option.value) && <Check size={14} />}</CheckIcon>,
      disabled: option.disabled,
      type: option.type || (option.options ? 'group' : undefined),
      children: option.options?.map(mapOption)
    })

    return options.map(mapOption)
  }, [options, selectedValues])

  function onClick(e: { key: string }) {
    if (disabled) return

    const newValue = e.key as V
    if (multiple) {
      const newValues = selectedValues.includes(newValue)
        ? selectedValues.filter((v) => v !== newValue)
        : [...selectedValues, newValue]
      ;(onChange as MultipleSelectorProps<V>['onChange'])(newValues)
    } else {
      ;(onChange as SingleSelectorProps<V>['onChange'])(newValue)
      setOpen(false)
    }
  }

  const handleOpenChange: DropdownProps['onOpenChange'] = (nextOpen, info) => {
    if (disabled) return

    if (info.source === 'trigger' || nextOpen) {
      setOpen(nextOpen)
    }
  }

  return (
    <Dropdown
      overlayClassName="selector-dropdown"
      menu={{ items, onClick }}
      trigger={['click']}
      placement={placement}
      open={open && !disabled}
      onOpenChange={handleOpenChange}>
      <Label $size={size} $open={open} $disabled={disabled} $isPlaceholder={label === placeholder}>
        {label}
        <LabelIcon size={size + 3} />
      </Label>
    </Dropdown>
  )
}

const LabelIcon = styled(ChevronsUpDown)`
  border-radius: 4px;
  padding: 2px 0;
  background-color: var(--color-background-soft);
  transition: background-color 0.2s;
`

const Label = styled.div<{ $size: number; $open: boolean; $disabled: boolean; $isPlaceholder: boolean }>`
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 99px;
  padding: 3px 2px 3px 10px;
  font-size: ${({ $size }) => $size}px;
  line-height: 1;
  cursor: ${({ $disabled }) => ($disabled ? 'not-allowed' : 'pointer')};
  opacity: ${({ $disabled }) => ($disabled ? 0.6 : 1)};
  color: ${({ $isPlaceholder }) => ($isPlaceholder ? 'var(--color-text-2)' : 'inherit')};

  transition:
    background-color 0.2s,
    opacity 0.2s;
  &:hover {
    ${({ $disabled }) =>
      !$disabled &&
      css`
        background-color: var(--color-background-mute);
        ${LabelIcon} {
          background-color: var(--color-background-mute);
        }
      `}
  }
  ${({ $open, $disabled }) =>
    $open &&
    !$disabled &&
    css`
      background-color: var(--color-background-mute);
      ${LabelIcon} {
        background-color: var(--color-background-mute);
      }
    `}
`

const CheckIcon = styled.div`
  width: 20px;
  display: flex;
  align-items: center;
  justify-content: end;
`

export default Selector
