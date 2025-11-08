import { DownOutlined, RightOutlined } from '@ant-design/icons'
import { cn } from '@renderer/utils'
import { Tooltip } from 'antd'
import type { FC, ReactNode } from 'react'

interface TagGroupProps {
  tag: string
  isCollapsed: boolean
  onToggle: (tag: string) => void
  showTitle?: boolean
  children: ReactNode
}

export const TagGroup: FC<TagGroupProps> = ({ tag, isCollapsed, onToggle, showTitle = true, children }) => {
  return (
    <TagsContainer>
      {showTitle && (
        <GroupTitle onClick={() => onToggle(tag)}>
          <Tooltip title={tag}>
            <GroupTitleName>
              {isCollapsed ? (
                <RightOutlined style={{ fontSize: '10px', marginRight: '5px' }} />
              ) : (
                <DownOutlined style={{ fontSize: '10px', marginRight: '5px' }} />
              )}
              {tag}
            </GroupTitleName>
          </Tooltip>
          <GroupTitleDivider />
        </GroupTitle>
      )}
      {!isCollapsed && <div>{children}</div>}
    </TagsContainer>
  )
}

const TagsContainer: FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, ...props }) => (
  <div className={cn('flex flex-col gap-2')} {...props}>
    {children}
  </div>
)

const GroupTitle: FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, ...props }) => (
  <div
    className={cn(
      'my-1 flex h-6 cursor-pointer flex-row items-center justify-between font-medium text-[var(--color-text-2)] text-xs'
    )}
    {...props}>
    {children}
  </div>
)

const GroupTitleName: FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, ...props }) => (
  <div
    className={cn('mr-1 box-border flex max-w-[50%] truncate px-1 text-[13px] text-[var(--color-text)] leading-6')}
    {...props}>
    {children}
  </div>
)

const GroupTitleDivider: FC<React.HTMLAttributes<HTMLDivElement>> = (props) => (
  <div className={cn('flex-1 border-[var(--color-border)] border-t')} {...props} />
)
