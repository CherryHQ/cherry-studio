import { Dropdown } from 'antd'
import { Check, ChevronsUpDown } from 'lucide-react'
import { ReactNode, useMemo, useState } from 'react'
import styled, { css } from 'styled-components'

interface SelectorOption<V = string | number> {
  label: string | ReactNode
  value: V
  type?: 'group'
  options?: SelectorOption<V>[]
  disabled?: boolean
}

interface SelectorProps<V = string | number> {
  options: SelectorOption<V>[]
  value?: V
  placeholder?: string
  placement?: 'topLeft' | 'topCenter' | 'topRight' | 'bottomLeft' | 'bottomCenter' | 'bottomRight' | 'top' | 'bottom'
  /** 字体大小 */
  size?: number
  /** 是否禁用 */
  disabled?: boolean
  onChange: (value: V) => void
}

const Selector = <V extends string | number>({
  options,
  value,
  onChange = () => {},
  placement = 'bottomRight',
  size = 13,
  placeholder,
  disabled = false
}: SelectorProps<V>) => {
  const [open, setOpen] = useState(false)

  const label = useMemo(() => {
    if (value !== undefined && value !== null) {
      const findLabel = (opts: SelectorOption<V>[]): string | ReactNode | undefined => {
        for (const opt of opts) {
          if (opt.value === value) {
            return opt.label
          }
          if (opt.options) {
            const found = findLabel(opt.options)
            if (found) return found
          }
        }
        return undefined
      }
      return findLabel(options) || placeholder
    }
    return placeholder
  }, [options, value, placeholder])

  const items = useMemo(() => {
    const mapOption = (option: SelectorOption<V>) => ({
      key: option.value,
      label: option.label,
      extra: <CheckIcon>{option.value === value && <Check size={14} />}</CheckIcon>,
      disabled: option.disabled,
      type: option.type || (option.options ? 'group' : undefined),
      children: option.options?.map(mapOption)
    })

    return options.map(mapOption)
  }, [options, value])

  function onClick(e: { key: string }) {
    if (!disabled) {
      onChange(e.key as V)
    }
  }

  return (
    <Dropdown
      overlayClassName="selector-dropdown"
      menu={{ items, onClick }}
      trigger={disabled ? [] : ['click']}
      placement={placement}
      open={open && !disabled}
      onOpenChange={disabled ? undefined : setOpen}>
      <Label $size={size} $open={open} $disabled={disabled}>
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

const Label = styled.div<{ $size: number; $open: boolean; $disabled: boolean }>`
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 99px;
  padding: 3px 2px 3px 10px;
  font-size: ${({ $size }) => $size}px;
  line-height: 1;
  cursor: ${({ $disabled }) => ($disabled ? 'not-allowed' : 'pointer')};
  opacity: ${({ $disabled }) => ($disabled ? 0.6 : 1)};
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
