import { ConfigProvider, Dropdown } from 'antd'
import { Check, ChevronsUpDown } from 'lucide-react'
import { ReactNode, useMemo, useState } from 'react'
import styled, { createGlobalStyle, css } from 'styled-components'

interface SelectorProps<V = string | number> {
  options: { label: string | ReactNode; value: V }[]
  value?: V
  placeholder?: string
  placement?: 'topLeft' | 'topCenter' | 'topRight' | 'bottomLeft' | 'bottomCenter' | 'bottomRight' | 'top' | 'bottom'
  /** 字体大小 */
  size?: number
  onChange: (value: V) => void
}

const Selector = <V extends string | number>({
  options,
  value,
  onChange = () => {},
  placement = 'bottomRight',
  size = 13,
  placeholder
}: SelectorProps<V>) => {
  const [open, setOpen] = useState(false)

  const label = useMemo(() => {
    if (value) {
      return options?.find((option) => option.value === value)?.label
    }
    return placeholder
  }, [options, value, placeholder])

  const items = useMemo(() => {
    return options.map((option) => ({
      key: option.value,
      label: option.label,
      extra: <CheckIcon>{option.value === value && <Check size={14} />}</CheckIcon>
    }))
  }, [options, value])

  function onClick(e: { key: string }) {
    onChange(e.key as V)
  }

  return (
    <ConfigProvider
      theme={{
        components: {
          Dropdown: {
            controlPaddingHorizontal: 5
          }
        }
      }}>
      <SelectorStyle />
      <Dropdown
        overlayClassName="selector-dropdown"
        menu={{ items, onClick }}
        trigger={['click']}
        placement={placement}
        open={open}
        onOpenChange={setOpen}>
        <Label $size={size} $open={open}>
          {label}
          <LabelIcon size={size + 3} />
        </Label>
      </Dropdown>
    </ConfigProvider>
  )
}

const SelectorStyle = createGlobalStyle`
  .ant-dropdown-menu {
    max-height: 40vh;
    overflow-y: auto;
  }
`

const LabelIcon = styled(ChevronsUpDown)`
  border-radius: 4px;
  padding: 2px 0;
  background-color: var(--color-background-soft);
  transition: background-color 0.2s;
`

const Label = styled.div<{ $size: number; $open: boolean }>`
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 99px;
  padding: 1px 2px 1px 10px;
  font-size: ${({ $size }) => $size}px;
  cursor: pointer;
  transition: background-color 0.2s;
  &:hover {
    background-color: var(--color-background-mute);
    ${LabelIcon} {
      background-color: var(--color-background-mute);
    }
  }
  ${({ $open }) =>
    $open &&
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
