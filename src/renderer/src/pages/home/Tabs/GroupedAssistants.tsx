import { PlusOutlined } from '@ant-design/icons'
import { DropResult } from '@hello-pangea/dnd'
import DragableList from '@renderer/components/DragableList'
import AddGroupPopup from '@renderer/components/Popups/AddGroupPopup'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { Assistant } from '@renderer/types'
import { useState } from 'react'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AssistantItem from './AssistantItem'

interface GroupedAssistantsProps {
  groups: Array<{
    id: string
    name: string
    members: string[]
    expanded?: boolean
  }>
  assistants: Assistant[]
  activeAssistant: Assistant
  onDelete: (assistant: Assistant) => void
  setActiveAssistant: (assistant: Assistant) => void
  addAgent: (assistant: Assistant) => void
  addAssistant: (assistant: Assistant) => void
  onCreateDefaultAssistant: () => void
  updateGroups: (groups: any[], assistants?: string[]) => void
}

const GroupedAssistants: FC<GroupedAssistantsProps> = ({
  groups,
  assistants,
  activeAssistant,
  onDelete,
  setActiveAssistant,
  addAgent,
  addAssistant,
  onCreateDefaultAssistant,
  updateGroups
}) => {
  const { t } = useTranslation()
  const { updateAssistants } = useAssistants()
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null)
  const [hoverGroupId, setHoverGroupId] = useState<string | null>(null)

  const handleDragStart = (result: any, type?: string) => {
    if (type === 'GROUP') {
      return
    }
    const sourceGroupId = groups.find((group) => group.members.includes(result.draggableId))?.id
    setDraggingGroupId(sourceGroupId || null)
  }

  const handleDragEnd = (result: DropResult) => {
    console.log('handleDragEnd', result)
    if (!result.destination) {
      setDraggingGroupId(null)
      setHoverGroupId(null)
      return
    }

    // 处理组排序
    if (result.type === 'GROUP') {
      const items = Array.from(groups)
      const [reorderedItem] = items.splice(result.source.index, 1)
      items.splice(result.destination.index, 0, reorderedItem)
      updateGroups(items)
      return
    }

    // 处理跨组助手移动
    if (draggingGroupId && hoverGroupId && draggingGroupId !== hoverGroupId) {
      const assistantId = result.draggableId
      const newGroups = groups.map((group) => {
        if (group.id === draggingGroupId) {
          return {
            ...group,
            members: group.members.filter((id) => id !== assistantId)
          }
        }
        if (group.id === hoverGroupId) {
          return {
            ...group,
            members: [...group.members, assistantId]
          }
        }
        return group
      })
      updateGroups(newGroups)
    }
    setDraggingGroupId(null)
    setHoverGroupId(null)
  }

  const handleDragOver = (groupId: string) => {
    if (draggingGroupId && draggingGroupId !== groupId) {
      setHoverGroupId(groupId)
    }
  }
  return (
    <>
      <DragableList
        list={groups}
        onUpdate={(items) => updateGroups(items as any[])}
        onDragStart={(result) => handleDragStart(result, 'GROUP')}
        onDragEnd={handleDragEnd}
        droppableId="groups"
        style={{ paddingBottom: 0 }}>
        {(group) => (
          <GroupContainer
            key={group.id}
            isDraggingOver={hoverGroupId === group.id}
            isSourceGroup={draggingGroupId === group.id}
            onDragEnter={() => handleDragOver(group.id)}
            onDragLeave={() => setHoverGroupId(null)}>
            <GroupTitle
              onClick={() => {
                updateGroups(groups.map((g) => (g.id === group.id ? { ...g, expanded: !g.expanded } : g)))
              }}>
              <span>{group.name}</span>
              <ExpandIcon expanded={group.expanded !== false}>
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </ExpandIcon>
            </GroupTitle>
            {group.expanded === false ? null : (
              <>
                {assistants.filter((a) => group.members.includes(a.id)).length > 0 ? (
                  <DragableList
                    list={assistants.filter((a) => group.members.includes(a.id))}
                    onUpdate={updateAssistants}
                    onDragStart={(result) => handleDragStart(result)}
                    onDragEnd={handleDragEnd}
                    style={{ paddingBottom: 0 }}>
                    {(assistant) => (
                      <AssistantItem
                        key={assistant.id}
                        assistant={assistant}
                        isActive={assistant.id === activeAssistant.id}
                        onSwitch={setActiveAssistant}
                        onDelete={onDelete}
                        addAgent={addAgent}
                        addAssistant={addAssistant}
                        onCreateDefaultAssistant={onCreateDefaultAssistant}
                      />
                    )}
                  </DragableList>
                ) : (
                  <EmptyPlaceholder>{t('chat.empty.assistants')}</EmptyPlaceholder>
                )}
              </>
            )}
          </GroupContainer>
        )}
      </DragableList>
      {/* 添加分组 */}
      <AssistantAddItem
        onClick={async () => {
          const group = await AddGroupPopup.show()
          if (group) {
            updateGroups([...groups, group])
          }
        }}>
        <AssistantName>
          <PlusOutlined style={{ color: 'var(--color-text-2)', marginRight: 4 }} />
          {t('chat.add.group.title')}
        </AssistantName>
      </AssistantAddItem>
    </>
  )
}

interface GroupContainerProps {
  isDraggingOver: boolean
  isSourceGroup: boolean
}

const GroupContainer = styled.div<GroupContainerProps>`
  background-color: ${(props) => (props.isDraggingOver ? 'var(--color-background-mute)' : 'transparent')};
  opacity: ${(props) => (props.isSourceGroup ? 0.5 : 1)};
  transition: all 0.2s ease;
  border-bottom: 1px solid var(--color-border-soft);
  padding-bottom: 8px;
  margin-bottom: 8px;
  &:last-child {
    border-bottom: none;
  }
`

const GroupTitle = styled.div`
  font-size: 12px;
  color: var(--color-text-2);
  margin-bottom: 5px;
  padding-left: 5px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  &:hover {
    color: var(--color-text);
  }
`

const ExpandIcon = styled.div<{ expanded: boolean }>`
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s ease;
  transform: ${(props) => (props.expanded ? 'rotate(0deg)' : 'rotate(90deg)')};
  svg {
    width: 12px;
    height: 12px;
    stroke: var(--color-text-2);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
`

const AssistantAddItem = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 7px 12px;
  position: relative;
  padding-right: 35px;
  font-family: Ubuntu;
  border-radius: var(--list-item-border-radius);
  border: 0.5px solid transparent;
  cursor: pointer;

  &:hover {
    background-color: var(--color-background-soft);
  }

  &.active {
    background-color: var(--color-background-soft);
    border: 0.5px solid var(--color-border);
  }
`

const EmptyPlaceholder = styled.div`
  color: var(--color-text-3);
  font-size: 12px;
  padding: 8px 12px;
  text-align: center;
`

const AssistantName = styled.div`
  color: var(--color-text);
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
`

export default GroupedAssistants
