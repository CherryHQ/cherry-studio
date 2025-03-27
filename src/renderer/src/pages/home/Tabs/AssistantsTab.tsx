import {
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  FolderAddOutlined,
  HolderOutlined,
  LoadingOutlined,
  PlusOutlined,
  RightOutlined
} from '@ant-design/icons'
import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd'
import { useAgents } from '@renderer/hooks/useAgents'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppSelector } from '@renderer/store'
import { Assistant, AssistantGroup } from '@renderer/types'
import { droppableReorder } from '@renderer/utils'
import { Alert, Form, Input, Modal, Spin } from 'antd'
import { FC, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { v4 as uuid } from 'uuid'

import AssistantItem from './AssistantItem'

interface AssistantsTabProps {
  activeAssistant: Assistant
  setActiveAssistant: (assistant: Assistant) => void
  onCreateAssistant: () => void
  onCreateDefaultAssistant: () => void
}

// 自定义 safeFilter 和 safeMap 函数实现，避免import错误
function safeFilter<T>(arr: T[] | null | undefined, predicate: (value: T, index: number, array: T[]) => boolean): T[] {
  if (!Array.isArray(arr)) return []
  return arr.filter(predicate)
}

function safeMap<T, U>(arr: T[] | null | undefined, callback: (value: T, index: number, array: T[]) => U): U[] {
  if (!Array.isArray(arr)) return []
  return arr.map(callback)
}

const Assistants: FC<AssistantsTabProps> = ({
  activeAssistant,
  setActiveAssistant,
  onCreateAssistant,
  onCreateDefaultAssistant
}) => {
  const {
    assistants,
    addGroup,
    updateGroup,
    removeGroup,
    updateAssistantGroup,
    addAssistant,
    removeAssistant,
    updateGroupsOrder
  } = useAssistants()
  const { groups, isLoading, loadingError } = useAppSelector((state) => state.assistants) // 直接从store获取状态
  const { enableAssistantGroup } = useSettings()
  const { addAgent } = useAgents()
  const [form] = Form.useForm()
  const [groupModalVisible, setGroupModalVisible] = useState(false)
  const [currentGroup, setCurrentGroup] = useState<AssistantGroup | null>(null)
  // 从localStorage获取已保存的分组展开状态，如果没有则默认全部展开
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    try {
      const savedState = localStorage.getItem('assistantGroups_expandedState')
      if (savedState) {
        const parsedState = JSON.parse(savedState)
        return new Set(parsedState)
      }
    } catch (e) {
      console.error('Error loading group expanded state:', e)
    }
    return new Set(safeMap(groups, (g) => g.id)) // 默认展开所有分组
  })
  const [dragging, setDragging] = useState(false)
  const dropTargetRef = useRef<string | null>(null)
  const { t } = useTranslation()

  // 错误处理和数据加载检查
  useEffect(() => {
    if (loadingError) {
      console.error('加载助手数据时出错:', loadingError)
      // 可以在这里添加错误通知或重试逻辑
    }
  }, [loadingError])

  const handleCreateGroup = () => {
    setCurrentGroup(null)
    form.resetFields()
    setGroupModalVisible(true)
  }

  const handleEditGroup = (group: AssistantGroup, e: React.MouseEvent) => {
    e.stopPropagation() // 阻止事件冒泡到toggle
    setCurrentGroup(group)
    form.setFieldsValue({
      name: group.name,
      description: group.description
    })
    setGroupModalVisible(true)
  }

  const handleDeleteGroup = (groupId: string) => {
    window.modal.confirm({
      title: t('assistants.group.delete.title'),
      content: t('assistants.group.delete.content'),
      okButtonProps: { danger: true },
      centered: true,
      onOk: () => {
        removeGroup(groupId)
      }
    })
  }

  const handleGroupSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (currentGroup) {
        // 编辑分组
        updateGroup({
          ...currentGroup,
          name: values.name,
          description: values.description
        })
      } else {
        // 创建分组
        addGroup({
          id: uuid(),
          name: values.name,
          description: values.description,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
      }
      setGroupModalVisible(false)
    } catch (error) {
      console.error('Validate failed:', error)
    }
  }

  // 切换分组的展开/折叠状态
  const toggleGroupExpanded = (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation() // 阻止事件冒泡
    let newExpandedGroups: Set<string>
    if (expandedGroups.has(groupId)) {
      const newSet = new Set(expandedGroups)
      newSet.delete(groupId)
      newExpandedGroups = newSet
    } else {
      newExpandedGroups = new Set([...expandedGroups, groupId])
    }
    // 设置新状态
    setExpandedGroups(newExpandedGroups)
    // 保存到localStorage
    try {
      localStorage.setItem('assistantGroups_expandedState', JSON.stringify(Array.from(newExpandedGroups)))
    } catch (e) {
      console.error('Error saving group expanded state:', e)
    }
  }

  // 根据配置决定是否使用分组
  const ungroupedAssistants = enableAssistantGroup ? safeFilter(assistants, (a) => !a.groupId) : []

  // 处理将助手拖入分组
  const handleAssistantDragStart = (e: React.DragEvent, assistantId: string) => {
    setDragging(true)
    e.dataTransfer.setData('assistantId', assistantId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleAssistantDragEnd = () => {
    setDragging(false)
    dropTargetRef.current = null
  }

  const handleAssistantDragOver = (e: React.DragEvent, groupId: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    dropTargetRef.current = groupId !== null ? groupId : null
  }

  const handleAssistantDragLeave = () => {
    dropTargetRef.current = null
  }

  const handleAssistantDrop = (e: React.DragEvent, groupId: string | null) => {
    e.preventDefault()
    const assistantId = e.dataTransfer.getData('assistantId')
    if (assistantId) {
      // 传递正确的参数格式给Redux action，null值表示移到未分组区域
      updateAssistantGroup(assistantId, groupId || undefined)
    }
    setDragging(false)
    dropTargetRef.current = null
  }

  // 处理分组拖拽结束事件
  const handleGroupDragEnd = (result: DropResult) => {
    setDragging(false)
    const { source, destination } = result

    // 如果没有目标位置或拖拽到相同位置，则不执行任何操作
    if (!destination || (source.index === destination.index && source.droppableId === destination.droppableId)) {
      return
    }

    // 使用droppableReorder工具函数重新排序分组
    const reorderedGroups = droppableReorder<AssistantGroup>([...groups], source.index, destination.index)

    // 更新Redux中的分组顺序
    updateGroupsOrder(reorderedGroups)

    // 可以选择性地存储分组顺序到localStorage
    try {
      localStorage.setItem('assistantGroups_order', JSON.stringify(reorderedGroups.map((g) => g.id)))
    } catch (e) {
      console.error('Error saving group order:', e)
    }
  }

  // 渲染一个分组
  const renderGroup = (group: AssistantGroup, index: number) => {
    const isExpanded = expandedGroups.has(group.id)
    const groupAssistants = safeFilter(assistants, (a) => a.groupId === group.id)

    return (
      <Draggable key={group.id} draggableId={group.id} index={index}>
        {(provided, snapshot) => (
          <GroupContainer
            ref={provided.innerRef}
            {...provided.draggableProps}
            data-groupid={group.id}
            onDragOver={(e) => handleAssistantDragOver(e, group.id)}
            onDragLeave={handleAssistantDragLeave}
            onDrop={(e) => handleAssistantDrop(e, group.id)}
            className={`${dropTargetRef.current === group.id ? 'drag-over' : ''} ${snapshot.isDragging ? 'dragging' : ''}`}
            style={provided.draggableProps.style}>
            <GroupHeader onClick={(e) => toggleGroupExpanded(group.id, e)} className="group-header-style">
              <GroupTitle>
                <GroupIcon>{isExpanded ? <DownOutlined /> : <RightOutlined />}</GroupIcon>
                <div>{group.name}</div>
                <GroupCount>{groupAssistants.length}</GroupCount>
              </GroupTitle>
              <GroupActions className="group-actions">
                <span {...provided.dragHandleProps} className="drag-handle" onClick={(e) => e.stopPropagation()}>
                  <HolderOutlined />
                </span>
                <EditOutlined onClick={(e) => handleEditGroup(group, e)} />
                <DeleteOutlined
                  className="delete-icon"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteGroup(group.id)
                  }}
                />
              </GroupActions>
            </GroupHeader>
            <GroupContent className={isExpanded ? 'expanded' : 'collapsed'}>
              {safeMap(groupAssistants, (assistant) => (
                <div
                  key={assistant.id}
                  draggable="true"
                  onDragStart={(e) => handleAssistantDragStart(e, assistant.id)}
                  onDragEnd={handleAssistantDragEnd}
                  className="assistant-item-wrapper">
                  <AssistantItem
                    key={assistant.id}
                    assistant={assistant}
                    isActive={assistant.id === activeAssistant?.id}
                    onSwitch={setActiveAssistant}
                    onDelete={(assistant) => {
                      const remaining = assistants.filter((a) => a.id !== assistant.id)
                      if (assistant.id === activeAssistant?.id) {
                        const newActive = remaining[remaining.length - 1]
                        newActive ? setActiveAssistant(newActive) : onCreateDefaultAssistant()
                      }
                      removeAssistant(assistant.id)
                    }}
                    addAgent={addAgent}
                    addAssistant={addAssistant}
                    onCreateDefaultAssistant={onCreateDefaultAssistant}
                    onMoveToGroup={updateAssistantGroup}
                    groups={groups}
                  />
                </div>
              ))}
              {groupAssistants.length === 0 && <div className="empty-group">{t('assistants.group.empty')}</div>}
            </GroupContent>
          </GroupContainer>
        )}
      </Draggable>
    )
  }

  return (
    <Container>
      {loadingError && (
        <Alert message={t('common.loading_error')} description={loadingError.message} type="error" showIcon />
      )}

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
          <div style={{ marginTop: '10px' }}>{t('common.loading')}</div>
        </div>
      ) : (
        <>
          {enableAssistantGroup ? (
            <>
              {/* 未分组的助手 */}
              <UngroupedSection
                $enableGroup={true}
                className={dropTargetRef.current === null && dragging ? 'drag-over' : ''}
                onDragOver={(e) => handleAssistantDragOver(e, null)}
                onDragLeave={handleAssistantDragLeave}
                onDrop={(e) => handleAssistantDrop(e, null)}>
                <div className="section-title">{t('assistants.ungrouped')}</div>
                {safeMap(ungroupedAssistants, (assistant) => (
                  <div
                    key={assistant.id}
                    className="assistant-item-wrapper"
                    draggable={true}
                    onDragStart={(e) => handleAssistantDragStart(e, assistant.id)}
                    onDragEnd={handleAssistantDragEnd}>
                    <AssistantItem
                      key={assistant.id}
                      assistant={assistant}
                      isActive={assistant.id === activeAssistant?.id}
                      onSwitch={setActiveAssistant}
                      onDelete={(assistant) => {
                        const remaining = assistants.filter((a) => a.id !== assistant.id)
                        if (assistant.id === activeAssistant?.id) {
                          const newActive = remaining[remaining.length - 1]
                          newActive ? setActiveAssistant(newActive) : onCreateDefaultAssistant()
                        }
                        removeAssistant(assistant.id)
                      }}
                      addAgent={addAgent}
                      addAssistant={addAssistant}
                      onCreateDefaultAssistant={onCreateDefaultAssistant}
                      onMoveToGroup={updateAssistantGroup}
                      groups={groups}
                    />
                  </div>
                ))}
              </UngroupedSection>

              {/* 分割线 - 只有当未分组助手和有分组都存在时才显示 */}
              {ungroupedAssistants.length > 0 && groups.length > 0 && <SectionDivider />}

              {/* 分组助手 */}
              <GroupsContainer>
                <DragDropContext onDragEnd={handleGroupDragEnd}>
                  <Droppable droppableId="assistantGroups">
                    {(provided) => (
                      <div className="assistant-groups-container" ref={provided.innerRef} {...provided.droppableProps}>
                        {safeMap(groups, (group, index) => renderGroup(group, index))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
              </GroupsContainer>

              {/* 添加按钮 - 移到底部 */}
              <ActionButtons>
                {!dragging && (
                  <>
                    <CreateButton onClick={onCreateAssistant}>
                      <PlusOutlined />
                      {t('assistants.add.title')}
                    </CreateButton>
                    <GroupCreateButton onClick={handleCreateGroup}>
                      <FolderAddOutlined />
                      {t('assistants.group.add.title')}
                    </GroupCreateButton>
                  </>
                )}
              </ActionButtons>
            </>
          ) : (
            <div className="assistants-list">
              {safeMap(assistants, (assistant) => (
                <AssistantItem
                  key={assistant.id}
                  assistant={assistant}
                  isActive={assistant.id === activeAssistant?.id}
                  onSwitch={setActiveAssistant}
                  onDelete={(assistant) => {
                    const remaining = assistants.filter((a) => a.id !== assistant.id)
                    if (assistant.id === activeAssistant?.id) {
                      const newActive = remaining[remaining.length - 1]
                      newActive ? setActiveAssistant(newActive) : onCreateDefaultAssistant()
                    }
                    removeAssistant(assistant.id)
                  }}
                  addAgent={addAgent}
                  addAssistant={addAssistant}
                  onCreateDefaultAssistant={onCreateDefaultAssistant}
                  onMoveToGroup={updateAssistantGroup}
                  groups={groups}
                />
              ))}
              <AddAssistantItem onClick={onCreateAssistant}>
                <AssistantName>
                  <PlusOutlined style={{ fontSize: '16px', marginRight: '6px' }} />
                  {t('assistants.add.title')}
                </AssistantName>
              </AddAssistantItem>
            </div>
          )}
        </>
      )}

      {/* 添加/编辑分组的弹窗 */}
      <Modal
        open={groupModalVisible}
        title={currentGroup ? t('assistants.group.edit.title') : t('assistants.group.add.title')}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        onCancel={() => setGroupModalVisible(false)}
        onOk={handleGroupSubmit}
        centered>
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label={t('assistants.group.name')}
            rules={[{ required: true, message: t('assistants.group.validation.name') }]}>
            <Input placeholder={t('assistants.group.name.placeholder')} maxLength={50} showCount />
          </Form.Item>
          <Form.Item name="description" label={t('assistants.group.description')}>
            <Input.TextArea
              placeholder={t('assistants.group.description.placeholder')}
              maxLength={200}
              showCount
              rows={4}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Container>
  )
}

export default Assistants

const Container = styled.div`
  height: 100%;
  overflow-y: auto;
  padding: 0 16px 16px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;

  /* 解决拖拽时的白边问题 */
  [draggable] {
    -webkit-user-drag: element;
    user-select: none;
  }

  .assistants-list {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow-y: auto;
  }
`

const GroupsContainer = styled.div`
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;

  .assistant-groups-container {
    display: flex;
    flex-direction: column;
    flex: 1;
  }
`

const GroupContainer = styled.div<{ isDragging?: boolean }>`
  margin-bottom: 4px;
  position: relative;
  border-radius: 6px;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  flex: 1;

  &.drag-over {
    background-color: var(--color-bg-3);
    border-radius: 6px;
    outline: 2px solid var(--color-primary);
  }

  &.dragging {
    opacity: 0.8;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.15);
  }
`

const GroupHeader = styled.div`
  padding: 10px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  user-select: none;
  position: relative;
  border-radius: 6px;

  &:hover {
    background-color: var(--color-bg-2);
    .group-actions {
      opacity: 1;
      visibility: visible;
    }
  }
`

const GroupTitle = styled.div`
  display: flex;
  align-items: center;
  flex-grow: 1;
  font-weight: 500;
  font-size: 13px;
`

const GroupIcon = styled.span`
  margin-right: 8px;
  font-size: 12px;
  color: var(--color-text-3);
`

const GroupCount = styled.span`
  margin-left: 8px;
  color: var(--color-text-3);
  font-size: 12px;
  font-weight: normal;
`

const GroupActions = styled.div`
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s;
  display: flex;
  gap: 8px;

  .drag-handle {
    cursor: grab;
    display: flex;
    align-items: center;

    &:active {
      cursor: grabbing;
    }
  }

  .anticon {
    cursor: pointer;
    color: var(--color-text-3);
    &:hover {
      color: var(--color-text-1);
    }
  }
  .delete-icon:hover {
    color: var(--color-error);
  }
`

const GroupContent = styled.div`
  padding-left: 20px;
  overflow: hidden;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;

  &.expanded {
    display: block;
  }
  &.collapsed {
    display: none;
  }

  .empty-group {
    padding: 8px 12px;
    color: var(--color-text-3);
    font-size: 13px;
  }
`

const ActionButtons = styled.div`
  display: flex;
  gap: 10px;
  padding: 10px;
  margin-top: 10px;
  margin-bottom: 10px;
  button {
    flex: 1;
  }
`

const CreateButton = styled.button`
  height: 34px;
  border-radius: 6px;
  border: none;
  background-color: var(--color-primary);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.3s;
  &:hover {
    background-color: #05d47b;
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    color: #fff;
  }
`

const GroupCreateButton = styled(CreateButton)`
  background-color: var(--color-neutral-5);
  color: var(--color-text-1);
  &:hover {
    background-color: var(--color-neutral-6);
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    color: var(--color-primary);
  }
`

const AssistantName = styled.div`
  display: flex;
  align-items: center;
  font-size: 14px;
  color: var(--color-text-2);
`

const AddAssistantItem = styled.div`
  padding: 7px 12px;
  margin-left: 10px;
  margin-right: 4px;
  margin-bottom: 8px;
  border-radius: 6px;
  border: 1px dashed var(--color-border);
  background-color: var(--color-bg-2);
  cursor: pointer;
  display: flex;
  align-items: center;
  transition: all 0.2s;

  &:hover {
    border-color: var(--color-primary);
    background-color: var(--color-primary-bg);
  }
`

const UngroupedSection = styled.div<{ $enableGroup: boolean }>`
  padding: 8px;
  border-radius: 8px;
  min-height: 60px;
  overflow-y: auto;
  max-height: ${(props) => (props.$enableGroup ? '300px' : 'none')};
  flex-shrink: ${(props) => (props.$enableGroup ? 0 : 1)};
  flex-grow: ${(props) => (props.$enableGroup ? 0 : 1)};

  .section-title {
    font-size: 13px;
    color: var(--color-text-3);
    margin: 5px 8px;
    padding-left: 8px;
  }

  &.drag-over {
    background-color: var(--color-bg-3);
  }

  .assistant-item-wrapper[draggable='true'] {
    cursor: grab;
    &:active {
      cursor: grabbing;
    }
  }
`

const SectionDivider = styled.div`
  height: 1px;
  background-color: var(--color-border);
  margin: 8px 0;
`
