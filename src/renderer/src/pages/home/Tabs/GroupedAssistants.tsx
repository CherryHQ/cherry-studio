import {
  ColumnHeightOutlined,
  DeleteOutlined,
  EditOutlined,
  LeftCircleOutlined,
  PlusOutlined,
  VerticalAlignMiddleOutlined
} from '@ant-design/icons'
import { Draggable, Droppable, DropResult } from '@hello-pangea/dnd'
import DragableList from '@renderer/components/DragableList'
import AddGroupPopup from '@renderer/components/Popups/AddGroupPopup'
import { useGroups } from '@renderer/hooks/useGroups'
import { useAppDispatch } from '@renderer/store'
import { setExpandGroupIds } from '@renderer/store/groups'
import { Assistant } from '@renderer/types'
import { Popconfirm } from 'antd'
import VirtualList from 'rc-virtual-list'
import { useCallback, useEffect, useState } from 'react'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AssistantItem from './AssistantItem'
import AssitantModeSwitch from './AssitantModeSwitch'

interface GroupedAssistantsProps {
  assistants: Assistant[]
  activeAssistant: Assistant
  onDelete: (assistant: Assistant) => void
  setActiveAssistant: (assistant: Assistant) => void
  addAgent: (assistant: Assistant) => void
  addAssistant: (assistant: Assistant) => void
  setGroupMode: (type: 'groups' | 'assitants') => void
  onCreateDefaultAssistant: () => void
}

const GroupedAssistants: FC<GroupedAssistantsProps> = ({
  assistants,
  activeAssistant,
  onDelete,
  setActiveAssistant,
  addAgent,
  setGroupMode,
  addAssistant,
  onCreateDefaultAssistant
}) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const {
    groups,
    expandGroupIds,
    defaultGroupId,
    updateGroups,
    moveAssistantBetweenGroups,
    reorderGroups,
    initializeGroups,
    removeGroup,
    getNewGroupsfromUpdateGroup
  } = useGroups()
  const [assistantMap] = useState(() => new Map<string, Assistant>())
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    const set = new Set<string>()
    expandGroupIds?.forEach((id) => {
      set.add(id)
    })
    return set
  })

  // 构建助手ID到助手的映射并初始化分组
  useEffect(() => {
    assistants.forEach((assistant) => {
      assistantMap.set(assistant.id, assistant)
    })
    // 初始化分组和助手同步
    const assistantIds = assistants.map((a) => a.id)
    initializeGroups(assistantIds)
  }, [assistants, assistantMap, initializeGroups])

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { type, source, destination } = result
      if (type === 'ASSISTANT') {
        const sourceGroup = groups.find((g) => g.id === source.droppableId)
        if (!sourceGroup) return

        const destGroupId = destination?.droppableId ?? defaultGroupId
        const destIndex = destination?.index ?? groups.find((g) => g.id === defaultGroupId)?.members.length ?? 0

        const updatedGroups = moveAssistantBetweenGroups(
          source.droppableId,
          source.index,
          destGroupId,
          destIndex,
          groups
        )
        updateGroups(updatedGroups)
      } else if (type === 'DEFAULT') {
        if (!destination) return
        const updatedGroups = reorderGroups(source.index, destination.index, groups)
        updateGroups(updatedGroups)
      }
    },
    [defaultGroupId, groups, moveAssistantBetweenGroups, updateGroups, reorderGroups]
  )
  const toggleAllExpanded = useCallback(
    (isShowAll: boolean) => {
      const newSet: Set<string> = isShowAll ? new Set() : new Set(groups.map((g) => g.id))
      setExpandedGroups(newSet)
      dispatch(setExpandGroupIds(Array.from(newSet)))
    },
    [dispatch, groups]
  )
  const toggleExpanded = useCallback(
    (groupId: string) => {
      setExpandedGroups((prev) => {
        const newSet = new Set(prev)
        if (newSet.has(groupId)) {
          newSet.delete(groupId)
        } else {
          newSet.add(groupId)
        }
        dispatch(setExpandGroupIds(Array.from(newSet)))
        return newSet
      })
    },
    [dispatch]
  )

  return (
    <>
      {/* 添加分组和展开/收起操作 */}
      <BottonGroup>
        <AssitantModeSwitch groupMode={'groups'} setGroupMode={setGroupMode}></AssitantModeSwitch>
        <BottonGroupItem
          onClick={async () => {
            const group = await AddGroupPopup.show({
              mode: 'add'
            })
            if (group) {
              const newGroup = getNewGroupsfromUpdateGroup(group, [group, ...groups])
              updateGroups(newGroup)
              toggleExpanded(group.id)
            }
          }}>
          <PlusOutlined style={{ color: 'var(--color-text-2)', marginRight: 4 }} />
          {t('assistants.group.add')}
        </BottonGroupItem>
        {groups.length > 0 && (
          <>
            <BottonGroupItem
              onClick={() => {
                toggleAllExpanded(expandedGroups.size === groups.length)
              }}>
              {expandedGroups.size === groups.length ? (
                <>
                  <VerticalAlignMiddleOutlined style={{ color: 'var(--color-text-2)' }} />
                  <span>{t('assistants.group.collapseAll')}</span>
                </>
              ) : (
                <>
                  <ColumnHeightOutlined style={{ color: 'var(--color-text-2)' }} />
                  <span>{t('assistants.group.expandAll')}</span>
                </>
              )}
            </BottonGroupItem>
          </>
        )}
      </BottonGroup>
      <DragableList list={groups} onUpdate={() => {}} onDragEnd={handleDragEnd} style={{ paddingBottom: 0 }}>
        {(group) => (
          <Droppable droppableId={group.id} type="ASSISTANT">
            {(provided) => (
              <GroupContainer key={group.id} {...provided.droppableProps} ref={provided.innerRef}>
                <GroupTitle>
                  <GroupName defaultGroup={group.id === defaultGroupId}>{group.name}</GroupName>
                  <GroupActions>
                    {group.id !== defaultGroupId && (
                      <>
                        <Popconfirm
                          title={t('assistants.group.delete')}
                          placement="top"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => {
                            removeGroup(group.id)
                          }}
                          trigger="click">
                          <DeleteOutlined style={{ color: 'red' }} />
                        </Popconfirm>
                        <EditOutlined
                          style={{ color: 'blue' }}
                          onClick={async () => {
                            const newGroup = await AddGroupPopup.show({
                              mode: 'update',
                              group
                            })
                            if (newGroup) {
                              const updatedGroups = getNewGroupsfromUpdateGroup(newGroup, groups)
                              updateGroups(updatedGroups)
                            }
                          }}
                        />
                      </>
                    )}
                    <LeftCircleOutlined
                      onClick={() => {
                        toggleExpanded(group.id)
                      }}
                      style={{
                        transform: expandedGroups.has(group.id) ? 'rotate(-90deg)' : 'rotate(0deg)'
                      }}
                    />
                  </GroupActions>
                </GroupTitle>
                {!expandedGroups.has(group.id) ? null : (
                  <div>
                    {group.members.map((id) => assistantMap.get(id)).filter(Boolean).length > 0 ? (
                      <VirtualList data={group.members.map((id) => assistantMap.get(id)).filter(Boolean)} itemKey="id">
                        {(assistant, index) => {
                          return (
                            <Draggable
                              key={`draggable_${group.id}_${assistant.id}_${index}`}
                              draggableId={`draggable_${group.id}_${assistant.id}_${index}`}
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
                      <EmptyPlaceholder>{t('assistants.group.empty')}</EmptyPlaceholder>
                    )}
                    {provided.placeholder}
                  </div>
                )}
              </GroupContainer>
            )}
          </Droppable>
        )}
      </DragableList>
    </>
  )
}

const GroupContainer = styled.div`
  transition: all 0.2s ease;
  padding-bottom: 8px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--color-border-soft);
  &:last {
    border-bottom: none;
  }
`

const GroupName = styled.div<{ defaultGroup: boolean }>`
  font-size: 12px;
  color: var(--color-text);
  cursor: ${({ defaultGroup }) => (defaultGroup ? 'default' : 'pointer')};
`

const GroupTitle = styled.div`
  font-size: 12px;
  color: var(--color-text-2);
  margin-bottom: 5px;
  padding-left: 5px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: move;
  &:hover {
    color: var(--color-text);
    .group-name {
      color: var(--color-text);
    }
  }
`

const GroupActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const BottonGroup = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 4px 4px;
  position: sticky;
  bottom: -10px;
  background-color: var(--color-background);
  font-family: Ubuntu;
  border: 0.5px solid transparent;
  cursor: pointer;
`

const EmptyPlaceholder = styled.div`
  color: var(--color-text-3);
  font-size: 12px;
  padding: 8px 12px;
  text-align: center;
`

const BottonGroupItem = styled.div`
  color: var(--color-text);
  margin-bottom: 10px;
  display: flex;
  border: 0.5px solid var(--color-border);
  align-items: center;
  border-radius: 4px;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  padding: 4px 8px;
  border-radius: var(--list-item-border-radius);
  &:hover {
    background-color: var(--color-background-soft);
  }

  &.active {
    background-color: var(--color-background-soft);
    border: 0.5px solid var(--color-border);
  }
`

export default GroupedAssistants
