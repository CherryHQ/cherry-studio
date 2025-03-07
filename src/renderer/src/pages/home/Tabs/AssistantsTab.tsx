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
import { safeFilter, safeMap } from '@renderer/utils/safeArrayUtils'
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

const Assistants: FC<AssistantsTabProps> = ({
  activeAssistant,
  setActiveAssistant,
  onCreateAssistant,
  onCreateDefaultAssistant
}) => {

  const { assistants, addGroup, updateGroup, removeGroup, updateAssistantGroup, addAssistant, updateGroupsOrder } =
    useAssistants()
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
    const groupAssistants = safeFilter(assistants, (a) => a.groupId === group.id)
    const isExpanded = expandedGroups.has(group.id)

    return (
      <Draggable key={group.id} draggableId={group.id} index={index}>
        {(provided) => (
          <GroupContainer
            {...provided.draggableProps}
            ref={provided.innerRef}
            data-groupid={group.id}
            onDragOver={(e) => handleAssistantDragOver(e, group.id)}
            onDragLeave={handleAssistantDragLeave}
            onDrop={(e) => handleAssistantDrop(e, group.id)}
            className={dropTargetRef.current === group.id ? 'drag-over' : ''}>
            <GroupHeader className="group-header-style">
              <div onClick={(e) => toggleGroupExpanded(group.id, e)} style={{ display: 'flex', flex: 1 }}>
                <GroupTitle>
                  <GroupIcon>{isExpanded ? <DownOutlined /> : <RightOutlined />}</GroupIcon>
                  <div>{group.name}</div>
                  <GroupCount>{groupAssistants.length}</GroupCount>
                </GroupTitle>
              </div>
              <GroupActions className="group-actions">
                <span {...provided.dragHandleProps} className="drag-handle">
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
                    assistant={assistant}
                    isActive={activeAssistant && assistant.id === activeAssistant.id}
                    onSwitch={setActiveAssistant}
                    addAgent={addAgent}
                    addAssistant={addAssistant}
                    onCreateDefaultAssistant={onCreateDefaultAssistant}
                    onMoveToGroup={(assistantId, groupId) => updateAssistantGroup(assistantId, groupId)}
                    groups={groups}
                  />
                </div>
              ))}
            </GroupContent>
          </GroupContainer>
        )}
      </Draggable>
    )
  }

  return (
    <Container>
      {isLoading ? (
        <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
      ) : (
        <>
          {loadingError ? (
            <Alert message={t('assistants.load.error')} description={loadingError} type="error" showIcon />
          ) : (
            <>
              {enableAssistantGroup ? (
                // 启用分组时的显示方式
                <>
                  {/* 未分组的助手 */}
                  <UngroupedSection
                    onDragOver={(e) => handleAssistantDragOver(e, null)}
                    onDragLeave={handleAssistantDragLeave}
                    onDrop={(e) => handleAssistantDrop(e, null)}
                    className={dropTargetRef.current === null ? 'drag-over' : ''}
                    $enableGroup={true}>
                    <p className="section-title">{t('assistants.ungrouped')}</p>
                    {safeMap(ungroupedAssistants, (assistant) => (
                      <div
                        key={assistant.id}
                        draggable="true"
                        onDragStart={(e) => handleAssistantDragStart(e, assistant.id)}
                        onDragEnd={handleAssistantDragEnd}
                        className="assistant-item-wrapper">
                        <AssistantItem
                          assistant={assistant}
                          isActive={activeAssistant && assistant.id === activeAssistant.id}
                          onSwitch={setActiveAssistant}
                          addAgent={addAgent}
                          addAssistant={addAssistant}
                          onCreateDefaultAssistant={onCreateDefaultAssistant}
                          onMoveToGroup={(assistantId, groupId) => updateAssistantGroup(assistantId, groupId)}
                          groups={groups}
                        />
                      </div>
                    ))}
                  </UngroupedSection>

                  {/* 分割线 - 当分组展示时 */}
                  {ungroupedAssistants.length > 0 && groups.length > 0 && <SectionDivider />}

                  {/* 分组区域 - 可拖拽排序 */}
                  <DragDropContext onDragEnd={handleGroupDragEnd}>
                    <Droppable droppableId="groups-droppable">
                      {(provided) => (
                        <GroupsContainer {...provided.droppableProps} ref={provided.innerRef}>
                          {safeMap(groups, (group, index) => renderGroup(group, index))}
                          {provided.placeholder}
                        </GroupsContainer>
                      )}
                    </Droppable>
                  </DragDropContext>
                </>
              ) : (
                // 未启用分组时的原始显示方式
                <UngroupedSection $enableGroup={false}>
                  {safeMap(assistants, (assistant) => (
                    <div key={assistant.id} className="assistant-item-wrapper">
                      <AssistantItem
                        assistant={assistant}
                        isActive={activeAssistant && assistant.id === activeAssistant.id}
                        onSwitch={setActiveAssistant}
                        addAgent={addAgent}
                        addAssistant={addAssistant}
                        onCreateDefaultAssistant={onCreateDefaultAssistant}
                      />
                    </div>
                  ))}
                </UngroupedSection>
              )}

              {/* 添加按钮 */}
              <ActionButtons>
                {!dragging && (
                  <>
                    {enableAssistantGroup ? (
                      <>
                        <CreateButton type="button" className="add-assistant-btn" onClick={onCreateAssistant}>
                          <PlusOutlined />
                          {t('chat.add.assistant.title')}
                        </CreateButton>
                        <GroupCreateButton type="button" className="add-group-btn" onClick={handleCreateGroup}>
                          <FolderAddOutlined />
                          {t('assistants.group.add')}
                        </GroupCreateButton>
                      </>
                    ) : (
                      <AssistantAddItem onClick={onCreateAssistant} style={{ width: '100%' }}>
                        <AssistantName>
                          <PlusOutlined style={{ color: 'var(--color-text-2)', marginRight: 4 }} />
                          {t('chat.add.assistant.title')}
                        </AssistantName>
                      </AssistantAddItem>
                    )}
                  </>
                )}
              </ActionButtons>

              {/* 创建/编辑分组模态框 */}
              <Modal
                title={currentGroup ? t('assistants.group.edit') : t('assistants.group.add')}
                open={groupModalVisible}
                onOk={handleGroupSubmit}
                onCancel={() => setGroupModalVisible(false)}
                destroyOnClose>
                <Form form={form} layout="vertical">
                  <Form.Item
                    name="name"
                    label={t('assistants.group.name')}
                    rules={[
                      {
                        required: true,
                        message: t('assistants.group.name.required')
                      }
                    ]}>
                    <Input placeholder={t('assistants.group.name.placeholder')} />
                  </Form.Item>
                  <Form.Item name="description" label={t('assistants.group.description')}>
                    <Input.TextArea placeholder={t('assistants.group.description.placeholder')} rows={3} />
                  </Form.Item>
                </Form>
              </Modal>
            </>
          )}
        </>
      )}
    </Container>
  )
}

export default Assistants

const Container = styled.div`
  display: flex;
  flex-direction: column;
  padding-top: 11px;
  user-select: none;
  height: 100%;

  .assistant-item-wrapper[draggable='true'] {
    cursor: grab;

    &:active {
      cursor: grabbing;
    }
  }

  /* 解决拖拽时的白边问题 */
  [draggable] {
    -webkit-user-drag: element;
    user-select: none;
  }
`

const UngroupedSection = styled.div<{ $enableGroup?: boolean }>`
  padding: 8px;
  border-radius: 8px;
  min-height: 60px;
  overflow-y: auto;
  max-height: ${(props) => (props.$enableGroup ? '300px' : 'none')};

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

const GroupsContainer = styled.div`
  flex: 1;
  overflow-y: auto;
`

const GroupContainer = styled.div`
  margin-bottom: 4px; /* 减小Group间距 */
  position: relative;
  /* 移除Group间分割线 */

  &.drag-over {
    background-color: var(--color-bg-3);
    border-radius: 6px;
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
  gap: 8px;
  font-weight: 500;
`

const GroupIcon = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  min-width: 16px; /* 确保最小宽度固定 */
  font-size: 12px;
  margin-right: 4px; /* 添加右边距使布局更一致 */
`

const GroupActions = styled.div`
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s;
  display: flex;
  gap: 8px;
  z-index: 10; /* 确保操作按钮不被盖住 */

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

  .drag-handle {
    cursor: grab;
    color: var(--color-text-3);
    &:hover {
      color: var(--color-text-1);
    }
    &:active {
      cursor: grabbing;
    }
  }
`

const GroupCount = styled.span`
  font-size: 12px;
  color: var(--color-text-3);
  background-color: var(--color-bg-3);
  padding: 1px 6px;
  border-radius: 10px;
  margin-left: 4px;
`

const GroupContent = styled.div`
  padding-left: 20px;
  overflow: hidden;
  padding-top: 8px;
  padding-bottom: 8px;

  &.expanded {
    display: block;
  }

  &.collapsed {
    display: none;
  }
`

const ActionButtons = styled.div`
  display: flex;
  gap: 10px;
  padding: 10px;
  margin-top: 10px;
  margin-bottom: 10px;
  background: var(--color-bg-1);
  z-index: 10;

  button {
    flex: 1;
  }
`

/* 新的按钮样式，带有更明显的悬停效果 */
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
  z-index: 2;

  &:hover {
    background-color: #05d47b; /* 使用更浅的绿色，但不透明 */
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    color: #fff; /* 修复hover效果变白的问题 */
  }
`

const GroupCreateButton = styled(CreateButton)`
  background-color: var(--color-neutral-5);
  color: var(--color-text-1);

  &:hover {
    background-color: var(--color-neutral-6);
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    color: var(--color-primary); /* 悬停时文字变为绿色 */
  }
`

/* 非分组模式下的加号按钮样式 */
const AssistantAddItem = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 7px 12px;
  position: relative;
  margin: 0 10px;
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

const AssistantName = styled.div`
  color: var(--color-text);
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
`
