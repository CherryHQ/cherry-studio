import { ConfigProvider, Dropdown } from 'antd'
import { Check, ChevronsUpDown } from 'lucide-react'
import { FC, useMemo } from 'react'
import styled from 'styled-components'

interface SelectorProps {
  options: { label: string; value: string }[]
  value: string | number | undefined
  placement?: 'topLeft' | 'topCenter' | 'topRight' | 'bottomLeft' | 'bottomCenter' | 'bottomRight' | 'top' | 'bottom'
  /** 字体大小 */
  size?: number
  onChange: (value: string) => void
}

const Selector: FC<SelectorProps> = ({ options, value, onChange, placement = 'bottomRight', size = 13 }) => {
  const label = useMemo(() => options?.find((option) => option.value === value)?.label, [options, value])

  const items = useMemo(() => {
    return options.map((option) => ({
      key: option.value,
      label: option.label,
      extra: <CheckIcon>{option.value === value && <Check size={14} />}</CheckIcon>
    }))
  }, [options, value])

  function onClick(e: { key: string }) {
    onChange(e.key)
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
      <Dropdown menu={{ items, onClick }} trigger={['click']} placement={placement}>
        <Label $size={size}>
          {label}
          <LabelIcon size={size + 3} />
        </Label>
      </Dropdown>
    </ConfigProvider>
  )
}

const Label = styled.div<{ $size: number }>`
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
  }
`

const LabelIcon = styled(ChevronsUpDown)`
  border-radius: 4px;
  padding: 2px 0;
  background-color: var(--color-background-mute);
`

const CheckIcon = styled.div`
  width: 20px;
  display: flex;
  align-items: center;
  justify-content: end;
`

export default Selector
