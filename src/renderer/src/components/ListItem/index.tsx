import { Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { ReactNode } from 'react'

interface ListItemProps {
  active?: boolean
  icon?: ReactNode
  title: ReactNode
  subtitle?: string
  titleStyle?: React.CSSProperties
  onClick?: () => void
  rightContent?: ReactNode
  style?: React.CSSProperties
}

const ListItem = ({ active, icon, title, subtitle, titleStyle, onClick, rightContent, style }: ListItemProps) => {
  return (
    <div
      className={cn(
        'relative flex cursor-pointer flex-col justify-between rounded-[var(--list-item-border-radius)] border border-transparent px-3 py-[7px] text-[13px] hover:bg-[var(--color-background-soft)]',
        active && 'bg-[var(--color-background-soft)]'
      )}
      onClick={onClick}
      style={style}>
      <div className="flex items-center gap-[2px] overflow-hidden text-[13px]">
        {icon && <span className="mr-2 flex items-center justify-center">{icon}</span>}
        <div className="flex flex-1 flex-col overflow-hidden">
          <Tooltip content={title} classNames={{ placeholder: 'block min-w-0' }}>
            <span className="block min-w-0 truncate" style={titleStyle}>
              {title}
            </span>
          </Tooltip>
          {subtitle && <div className="mt-[2px] line-clamp-1 text-[10px] text-[var(--color-text-3)]">{subtitle}</div>}
        </div>
        {rightContent && <div className="ml-auto">{rightContent}</div>}
      </div>
    </div>
  )
}

export default ListItem
