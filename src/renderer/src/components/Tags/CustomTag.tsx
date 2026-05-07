import { CloseOutlined } from '@ant-design/icons'
import { Tooltip } from '@cherrystudio/ui'
import type { FC } from 'react'
import { memo } from 'react'
import styled from 'styled-components'

export type CustomTagProps = {
  icon?: React.ReactNode
  children?: React.ReactNode | string
  color: string
  size?: number
  tooltip?: string
  closable?: boolean
  onClose?: () => void
  disabled?: boolean
  inactive?: boolean
  ref?: React.Ref<HTMLDivElement>
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'color'>

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
  onContextMenu,
  disabled,
  inactive,
  ref,
  ...rest
}) => {
  const actualColor = inactive ? '#aaaaaa' : color
  const tagContent = (
    <Tag
      ref={ref}
      $color={actualColor}
      $size={size}
      $closable={closable}
      $clickable={!disabled && !!onClick}
      onClick={disabled ? undefined : onClick}
      onContextMenu={disabled ? undefined : onContextMenu}
      style={{
        ...(disabled && { cursor: 'not-allowed' }),
        ...style
      }}
      {...rest}>
      {icon} {children}
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
  )

  return tooltip ? (
    <Tooltip content={tooltip} delay={300}>
      {tagContent}
    </Tooltip>
  ) : (
    tagContent
  )
}

export default memo(CustomTag)

const Tag = styled.div<{ $color: string; $size: number; $closable: boolean; $clickable: boolean }>`
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
  cursor: ${({ $clickable }) => ($clickable ? 'pointer' : 'auto')};
  .iconfont {
    font-size: ${({ $size }) => $size}px;
    color: ${({ $color }) => $color};
  }

  transition: opacity 0.2s ease;
  &:hover {
    opacity: ${({ $clickable }) => ($clickable ? 0.8 : 1)};
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
