// Original path: src/renderer/src/components/ListItem/index.tsx
import { Tooltip } from '@heroui/react'
import { ReactNode } from 'react'

import { cn } from '../../../utils'

interface ListItemProps {
  active?: boolean
  icon?: ReactNode
  title: ReactNode
  subtitle?: string
  titleStyle?: React.CSSProperties
  onClick?: () => void
  rightContent?: ReactNode
  style?: React.CSSProperties
  className?: string
  ref?: React.Ref<HTMLDivElement>
}

const ListItem = ({
  active,
  icon,
  title,
  subtitle,
  titleStyle,
  onClick,
  rightContent,
  style,
  className,
  ref
}: ListItemProps) => {
  return (
    <div
      ref={ref}
      className={cn(
        'px-3 py-1.5 rounded-md text-xs flex flex-col justify-between relative cursor-pointer border border-transparent',
        'hover:bg-gray-50 dark:hover:bg-gray-800',
        active && 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700',
        className
      )}
      onClick={onClick}
      style={style}>
      <div className="flex items-center gap-0.5 overflow-hidden text-xs">
        {icon && <span className="flex items-center justify-center mr-2">{icon}</span>}
        <div className="flex-1 flex flex-col overflow-hidden">
          <Tooltip content={title} placement="top">
            <div className="truncate text-gray-900 dark:text-gray-100" style={titleStyle}>
              {title}
            </div>
          </Tooltip>
          {subtitle && (
            <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{subtitle}</div>
          )}
        </div>
        {rightContent && <div className="ml-auto">{rightContent}</div>}
      </div>
    </div>
  )
}

export default ListItem
