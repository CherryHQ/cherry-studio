import { PlusOutlined } from '@ant-design/icons'
import { Draggable, DragStart, Droppable, DropResult } from '@hello-pangea/dnd'
import DragableList from '@renderer/components/DragableList'
import AddGroupPopup from '@renderer/components/Popups/AddGroupPopup'
import { useGroups } from '@renderer/hooks/useGroups'
import { Assistant } from '@renderer/types'
import VirtualList from 'rc-virtual-list'
import { useCallback, useEffect, useState } from 'react'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AssistantItem from './AssistantItem'

interface GroupedAssistantsProps {
  assistants: Assistant[]
  activeAssistant: Assistant
  onDelete: (assistant: Assistant) => void
  setActiveAssistant: (assistant: Assistant) => void
  addAgent: (assistant: Assistant) => void
  addAssistant: (assistant: Assistant) => void
  onCreateDefaultAssistant: () => void
}

const GroupedAssistants: FC<GroupedAssistantsProps> = ({
  assistants,
  activeAssistant,
  onDelete,
  setActiveAssistant,
  addAgent,
  addAssistant,
  onCreateDefaultAssistant
}) => {
  const { t } = useTranslation()
  const { groups, updateGroups } = useGroups()
  const [assistantMap] = useState(() => new Map<string, Assistant>())
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    const set = new Set<string>()
    if (groups.length > 0) {
      set.add(groups[0].id) // 默认展开第一个组
    }
    return set
  })

  // 构建助手ID到助手的映射
  useEffect(() => {
    assistants.forEach((assistant) => {
      assistantMap.set(assistant.id, assistant)
    })
  }, [assistants, assistantMap])

  const handleDragStart = useCallback(
    (result: DragStart) => {
      console.log('handleDragStart', result)
    },
    [groups]
  )

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      console.log('handleDragEnd', result)

      if (!result.source) return

      const { type, source, destination } = result

      if (type === 'ASSISTANT') {
        // 处理助手拖拽
        const sourceGroup = groups.find((g) => g.id === source.droppableId)
        if (!sourceGroup) return

        // 1. 没有destination的情况（移动到未分组）
        if (!destination) {
          if (sourceGroup.id === 'default') return // 未分组不能再移动到未分组

          const sourceMembers = [...sourceGroup.members]
          const [removed] = sourceMembers.splice(source.index, 1)

          const defaultGroup = groups.find((g) => g.id === 'default') || {
            id: 'default',
            name: '未分组',
            members: []
          }
          const updatedDefaultGroup = {
            ...defaultGroup,
            members: [...defaultGroup.members, removed]
          }

          const updatedGroups = groups.map((group) => {
            if (group.id === sourceGroup.id) {
              return { ...sourceGroup, members: sourceMembers }
            }
            if (group.id === 'default') {
              return updatedDefaultGroup
            }
            return group
          })

          updateGroups(updatedGroups)
          return
        }

        // 2. 有destination的情况
        const destGroup = groups.find((g) => g.id === destination.droppableId)
        const assistantId = result.draggableId
        if (destination) {
          // 1.1 同组内调整顺序
          if (source.droppableId === destination.droppableId) {
            const newMembers = [...sourceGroup.members]
            const [removed] = newMembers.splice(source.index, 1)
            newMembers.splice(destination.index, 0, removed)

            const updatedGroups = groups.map((group) =>
              group.id === source.droppableId ? { ...group, members: newMembers } : group
            )
            updateGroups(updatedGroups)
          }
          // 1.2 跨组移动
          else {
            // 从原组移除
            const sourceMembers = [...sourceGroup.members]
            sourceMembers.splice(source.index, 1)

            // 添加到目标组
            const destMembers = [...destGroup!.members]
            destMembers.splice(destination.index, 0, assistantId)

            const updatedGroups = groups.map((group) => {
              if (group.id === source.droppableId) {
                return { ...group, members: sourceMembers }
              }
              if (group.id === destination.droppableId) {
                return { ...group, members: destMembers }
              }
              return group
            })
            updateGroups(updatedGroups)
          }
        }
      }
      // 处理组顺序调整
      else if (type === 'DEFAULT') {
        if (!destination) return
        const newGroups = [...groups]
        const [removed] = newGroups.splice(source.index, 1)
        newGroups.splice(destination.index, 0, removed)
        updateGroups(newGroups)
      }
    },
    [groups, updateGroups]
  )

  return (
    <>
      <DragableList
        list={groups}
        onUpdate={() => {}}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        style={{ paddingBottom: 0 }}>
        {(group) => (
          <Droppable droppableId={group.id} type="ASSISTANT">
            {(provided) => (
              <GroupContainer key={group.id} {...provided.droppableProps} ref={provided.innerRef}>
                <GroupTitle
                  onClick={() => {
                    setExpandedGroups((prev) => {
                      const newSet = new Set(prev)
                      if (newSet.has(group.id)) {
                        newSet.delete(group.id)
                      } else {
                        newSet.add(group.id)
                      }
                      return newSet
                    })
                  }}>
                  <span>{group.name}</span>
                  <ExpandIcon expanded={expandedGroups.has(group.id)}>
                    <svg viewBox="0 0 24 24" fill="none">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </ExpandIcon>
                </GroupTitle>
                {!expandedGroups.has(group.id) ? null : (
                  <div>
                    {group.members.map((id) => assistantMap.get(id)).filter(Boolean).length > 0 ? (
                      <VirtualList data={group.members.map((id) => assistantMap.get(id)).filter(Boolean)} itemKey="id">
                        {(assistant, index) => {
                          return (
                            <Draggable
                              key={`draggable_${assistant.id}_${index}`}
                              draggableId={assistant.id}
                              index={index}>
                              {(provided) => (
                                <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
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
                                </div>
                              )}
                            </Draggable>
                          )
                        }}
                      </VirtualList>
                    ) : (
                      <EmptyPlaceholder>{t('chat.empty.assistants')}</EmptyPlaceholder>
                    )}
                    {provided.placeholder}
                  </div>
                )}
              </GroupContainer>
            )}
          </Droppable>
        )}
      </DragableList>
      {/* 添加分组 */}
      <AssistantAddItem
        onClick={async () => {
          const group = await AddGroupPopup.show()
          if (group) {
            updateGroups([group, ...groups])
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
  isDraggingOver?: boolean
  isSourceGroup?: boolean
}

const GroupContainer = styled.div<GroupContainerProps>`
  transition: all 0.2s ease;
  border-bottom: 1px solid var(--color-border-soft);
  padding-bottom: 8px;
  margin-bottom: 8px;
  background-color: ${(props) => (props.isDraggingOver ? 'var(--color-background-mute)' : 'transparent')};
  opacity: ${(props) => (props.isSourceGroup ? 0.5 : 1)};
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
    border-radius: 12px;
    width: 12px;
    height: 12px;
    stroke: var(--color-text-2);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  :hover {
    stroke: var(--color-text);
    background-color: var(--color-background-mute);
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
