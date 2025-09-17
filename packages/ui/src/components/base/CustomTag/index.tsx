// Original path: src/renderer/src/components/Tags/CustomTag.tsx
import { Tooltip } from '@heroui/react'
import { X } from 'lucide-react'
import type { CSSProperties, FC, MouseEventHandler } from 'react'
import { memo, useMemo } from 'react'

export interface CustomTagProps {
  icon?: React.ReactNode
  children?: React.ReactNode | string
  color: string
  size?: number
  style?: CSSProperties
  tooltip?: string
  closable?: boolean
  onClose?: () => void
  onClick?: MouseEventHandler<HTMLDivElement>
  disabled?: boolean
  inactive?: boolean
  className?: string
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
  inactive,
  className = ''
}) => {
  const actualColor = inactive ? '#aaaaaa' : color

  const tagContent = useMemo(
    () => (
      <div
        className={`inline-flex items-center gap-1 rounded-full whitespace-nowrap relative transition-opacity duration-200 ${
          !disabled && onClick ? 'cursor-pointer hover:opacity-80' : disabled ? 'cursor-not-allowed' : 'cursor-auto'
        } ${className}`}
        style={{
          padding: `${size / 3}px ${closable ? size * 1.8 : size * 0.8}px ${size / 3}px ${size * 0.8}px`,
          color: actualColor,
          backgroundColor: actualColor + '20',
          fontSize: `${size}px`,
          lineHeight: 1,
          ...style
        }}
        onClick={disabled ? undefined : onClick}>
        {icon && <span style={{ fontSize: `${size}px`, color: actualColor }}>{icon}</span>}
        {children}
        {closable && (
          <div
            className="absolute flex items-center justify-center cursor-pointer rounded-full transition-all duration-200 hover:bg-[#da8a8a] hover:text-white"
            style={{
              right: `${size * 0.2}px`,
              top: `${size * 0.2}px`,
              bottom: `${size * 0.2}px`,
              fontSize: `${size * 0.8}px`,
              color: actualColor,
              aspectRatio: 1
            }}
            onClick={(e) => {
              e.stopPropagation()
              onClose?.()
            }}>
            <X size={size * 0.8} />
          </div>
        )}
      </div>
    ),
    [actualColor, children, closable, disabled, icon, onClick, onClose, size, style, className]
  )

  return tooltip ? (
    <Tooltip content={tooltip} placement="top" delay={300}>
      {tagContent}
    </Tooltip>
  ) : (
    tagContent
  )
}

export default memo(CustomTag)
