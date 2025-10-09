import { DownOutlined, RightOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'
import { FC, ReactNode } from 'react'
import styled from 'styled-components'

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

export const TagsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const GroupTitle = styled.div`
  color: var(--color-text-2);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  height: 24px;
  margin: 5px 0;
`

const GroupTitleName = styled.div`
  max-width: 50%;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  box-sizing: border-box;
  padding: 0 4px;
  color: var(--color-text);
  font-size: 13px;
  line-height: 24px;
  margin-right: 5px;
  display: flex;
`

const GroupTitleDivider = styled.div`
  flex: 1;
  border-top: 1px solid var(--color-border);
`
