import { cn } from '@cherrystudio/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import type { CSSProperties, FC, MouseEventHandler } from 'react'
import { memo } from 'react'

const tagVariants = cva('inline-flex items-center justify-center whitespace-nowrap transition-opacity duration-200', {
  variants: {
    size: {
      lg: 'text-[18px] leading-[20px]',
      md: 'text-[16px] leading-[18px]',
      sm: 'text-[14px] leading-[16px]'
    },
    closable: {
      true: '',
      false: 'overflow-clip'
    }
  },
  compoundVariants: [
    { size: 'lg', closable: false, className: 'p-1 rounded-[8px]' },
    { size: 'md', closable: false, className: 'p-[3px] rounded-[8px]' },
    { size: 'sm', closable: false, className: 'p-0.5 rounded-[6px]' },
    { size: 'lg', closable: true, className: 'gap-0.5 px-2 py-[3px] rounded-[8px]' },
    { size: 'md', closable: true, className: 'gap-0.5 px-1.5 py-[3px] rounded-[8px]' },
    { size: 'sm', closable: true, className: 'gap-0.5 px-[3px] py-0.5 rounded-[6px]' }
  ],
  defaultVariants: {
    size: 'sm',
    closable: false
  }
})

const closeIconSizeMap = {
  lg: 18,
  md: 16,
  sm: 14
} as const

export interface TagProps extends VariantProps<typeof tagVariants> {
  icon?: React.ReactNode
  children?: React.ReactNode
  color: string
  style?: CSSProperties
  closable?: boolean
  onClose?: () => void
  onClick?: MouseEventHandler<HTMLDivElement>
  onContextMenu?: MouseEventHandler<HTMLDivElement>
  disabled?: boolean
  inactive?: boolean
  className?: string
}

const Tag: FC<TagProps> = ({
  children,
  icon,
  color,
  size = 'sm',
  style,
  closable = false,
  onClose,
  onClick,
  onContextMenu,
  disabled,
  inactive,
  className
}) => {
  const actualColor = inactive ? '#aaaaaa' : color
  const bgOpacity = closable ? '1a' : '33'
  const iconSize = closeIconSizeMap[size ?? 'sm']

  return (
    <div
      className={cn(
        tagVariants({ size, closable }),
        !disabled && onClick ? 'cursor-pointer hover:opacity-80' : disabled ? 'cursor-not-allowed' : '',
        className
      )}
      style={{
        color: actualColor,
        backgroundColor: actualColor + bgOpacity,
        ...style
      }}
      onClick={disabled ? undefined : onClick}
      onContextMenu={disabled ? undefined : onContextMenu}>
      {icon && (
        <span className="shrink-0" style={{ color: actualColor }}>
          {icon}
        </span>
      )}
      <span className="px-[3.5px]">{children}</span>
      {closable && (
        <span
          className="flex shrink-0 cursor-pointer items-center justify-center rounded-full transition-all duration-200 hover:bg-[#da8a8a] hover:text-white"
          style={{ color: actualColor }}
          onClick={(e) => {
            e.stopPropagation()
            onClose?.()
          }}>
          <X size={iconSize} />
        </span>
      )}
    </div>
  )
}

const MemoizedTag = memo(Tag)

export { MemoizedTag as Tag, tagVariants }
export default MemoizedTag
