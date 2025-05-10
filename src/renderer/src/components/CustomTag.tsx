import { CloseOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'
import { FC, memo, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'

interface CustomTagProps {
  icon?: React.ReactNode
  children?: React.ReactNode | string
  color: string
  size?: number
  tooltip?: string
  closable?: boolean
  onClose?: () => void
}

const CustomTag: FC<CustomTagProps> = ({ children, icon, color, size = 12, tooltip, closable = false, onClose }) => {
  const [showTooltip, setShowTooltip] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setShowTooltip(true), 300)
    return () => clearTimeout(timer)
  }, [])

  const tagContent = useMemo(
    () => (
      <Tag $color={color} $size={size} $closable={closable}>
        {icon && icon} {children}
        {closable && <CloseIcon $size={size} $color={color} onClick={onClose} />}
      </Tag>
    ),
    [children, color, closable, icon, onClose, size]
  )

  return tooltip && showTooltip ? (
    <Tooltip title={tooltip} placement="top">
      {tagContent}
    </Tooltip>
  ) : (
    tagContent
  )
}

export default memo(CustomTag)

const Tag = styled.div<{ $color: string; $size: number; $closable: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: ${({ $size }) => $size / 3}px ${({ $size }) => $size * 0.8}px;
  padding-right: ${({ $closable, $size }) => ($closable ? $size * 1.8 : $size * 0.8)}px;
  border-radius: 99px;
  color: ${({ $color }) => $color};
  background-color: ${({ $color }) => $color + '20'};
  font-size: ${({ $size }) => $size}px;
  line-height: 1;
  white-space: nowrap;
  position: relative;
  .iconfont {
    font-size: ${({ $size }) => $size}px;
    color: ${({ $color }) => $color};
  }
`

const CloseIcon = styled(CloseOutlined)<{ $size: number; $color: string }>`
  cursor: pointer;
  font-size: ${({ $size }) => $size * 0.8}px;
  color: ${({ $color }) => $color};
  display: flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  right: ${({ $size }) => $size * 0.2}px;
  top: ${({ $size }) => $size * 0.2}px;
  bottom: ${({ $size }) => $size * 0.2}px;
  border-radius: 99px;
  transition: all 0.2s ease;
  aspect-ratio: 1;
  line-height: 1;
  &:hover {
    background-color: #da8a8a;
    color: #ffffff;
  }
`
