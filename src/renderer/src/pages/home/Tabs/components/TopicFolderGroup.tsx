import { DownOutlined, RightOutlined } from '@ant-design/icons'
import { cn } from '@renderer/utils'
import { Tooltip } from 'antd'
import type { FC, ReactNode } from 'react'

interface TopicFolderGroupProps {
  folder: string
  isCollapsed: boolean
  onToggle: (folder: string) => void
  showTitle?: boolean
  children: ReactNode
}

export const TopicFolderGroup: FC<TopicFolderGroupProps> = ({
  folder,
  isCollapsed,
  onToggle,
  showTitle = true,
  children
}) => {
  return (
    <FolderContainer>
      {showTitle && (
        <FolderHeader onClick={() => onToggle(folder)}>
          <Tooltip title={folder}>
            <FolderHeaderName>
              {isCollapsed ? (
                <RightOutlined style={{ fontSize: '10px', marginRight: '5px' }} />
              ) : (
                <DownOutlined style={{ fontSize: '10px', marginRight: '5px' }} />
              )}
              {folder}
            </FolderHeaderName>
          </Tooltip>
          <FolderHeaderDivider />
        </FolderHeader>
      )}
      {!isCollapsed && <div>{children}</div>}
    </FolderContainer>
  )
}

const FolderContainer: FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, ...props }) => (
  <div className={cn('flex flex-col gap-2')} {...props}>
    {children}
  </div>
)

const FolderHeader: FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, ...props }) => (
  <div
    className={cn(
      'my-1 flex h-6 cursor-pointer flex-row items-center justify-between font-medium text-[var(--color-text-2)] text-xs'
    )}
    {...props}>
    {children}
  </div>
)

const FolderHeaderName: FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, ...props }) => (
  <div
    className={cn('mr-1 box-border flex max-w-[50%] truncate px-1 text-[13px] text-[var(--color-text)] leading-6')}
    {...props}>
    {children}
  </div>
)

const FolderHeaderDivider: FC<React.HTMLAttributes<HTMLDivElement>> = (props) => (
  <div className={cn('flex-1 border-[var(--color-border)] border-t')} {...props} />
)
