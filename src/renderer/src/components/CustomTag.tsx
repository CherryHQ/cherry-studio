import { Tooltip } from 'antd'
import { FC } from 'react'
import styled from 'styled-components'

interface CustomTagProps {
  icon?: React.ReactNode
  children?: React.ReactNode | string
  color: string
  size?: number
  tooltip?: string
}

const CustomTag: FC<CustomTagProps> = ({ children, icon, color, size = 12, tooltip }) => {
  return (
    <Tooltip title={tooltip} placement="top">
      <Tag $color={color} $size={size}>
        {icon && icon} {children}
      </Tag>
    </Tooltip>
  )
}

export default CustomTag

const Tag = styled.div<{ $color: string; $size: number }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: ${({ $size }) => $size / 3}px ${({ $size }) => $size * 0.8}px;
  border-radius: 99px;
  color: ${({ $color }) => $color};
  background-color: ${({ $color }) => $color + '20'};
  font-size: ${({ $size }) => $size}px;
  line-height: 1;
  white-space: nowrap;
  .iconfont {
    font-size: ${({ $size }) => $size}px;
    color: ${({ $color }) => $color};
  }
`
