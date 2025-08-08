import { CloseOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'
import { CSSProperties, FC, memo, useMemo } from 'react'
import styled from 'styled-components'

export interface CustomTagProps {
  icon?: React.ReactNode
  children?: React.ReactNode | string
  color: string
  size?: number
  style?: CSSProperties
  tooltip?: string
  closable?: boolean
  onClose?: () => void
  onClick?: () => void
  disabled?: boolean
  inactive?: boolean
}

const CustomTag: FC<CustomTagProps> = ({
  children,
  icon,
  color,
  size = 12,
  style,
  tooltip,
  closable = false,
  onClose,
  onClick,
  disabled,
  inactive
}) => {
  const actualColor = inactive ? '#aaaaaa' : color
  const tagContent = useMemo(
    () => (
      <Tag
        $color={actualColor}
        $size={size}
        $closable={closable}
        onClick={disabled ? undefined : onClick}
        style={{ cursor: disabled ? 'not-allowed' : onClick ? 'pointer' : 'auto', ...style }}>
        {icon && icon} {children}
        {closable && (
          <CloseIcon
            $size={size}
            $color={actualColor}
            onClick={(e) => {
              e.stopPropagation()
              onClose?.()
            }}
          />
        )}
      </Tag>
    ),
    [actualColor, children, closable, disabled, icon, onClick, onClose, size, style]
  )

  return tooltip ? (
    <Tooltip title={tooltip} placement="top" mouseEnterDelay={0.3}>
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
