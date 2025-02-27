import { FolderAddOutlined, PlusOutlined, DownOutlined, RightOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import DragableList from '@renderer/components/DragableList'
import Scrollbar from '@renderer/components/Scrollbar'
import { useAgents } from '@renderer/hooks/useAgents'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useTranslation } from 'react-i18next'
import { Assistant, AssistantGroup } from '@renderer/types'
import { Dropdown, Form, Input, Menu, message, Modal } from 'antd'
import { FC, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { v4 as uuid } from 'uuid'
import styled from 'styled-components'
import AssistantItem from './AssistantItem'
import { useAppSelector } from '@renderer/store'

interface AssistantsTabProps {
  activeAssistant: Assistant
  setActiveAssistant: (assistant: Assistant) => void
  onCreateAssistant: () => void
  onCreateDefaultAssistant: () => void
}

const Assistants: FC<AssistantsTabProps> = ({ activeAssistant, setActiveAssistant, onCreateAssistant, onCreateDefaultAssistant }) => {
  const { assistants, updateAssistants, addGroup, updateGroup, removeGroup, updateAssistantGroup, addAssistant, removeAssistant } = useAssistants()
  const { groups } = useAppSelector((state) => state.assistants) // 直接从store获取最新groups
  const { addAgent } = useAgents()
  const [form] = Form.useForm()
  const [groupModalVisible, setGroupModalVisible] = useState(false)
  const [currentGroup, setCurrentGroup] = useState<AssistantGroup | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(groups.map(g => g.id))) // 默认展开所有分组
  const [dragging, setDragging] = useState(false)
  const dropTargetRef = useRef<string | null>(null)
  const { t } = useTranslation()

  const onDelete = useCallback(
    (assistant: Assistant) => {
      // 判断是否有未保存的会话
      const unsavedChanges = false
      if (unsavedChanges) {
        window.modal.confirm({
          title: t('assistants.delete.unsaved.title'),
          content: t('assistants.delete.unsaved.content'),
          cancelText: t('common.cancel'),
          okText: t('common.confirm'),
          okButtonProps: { danger: true },
          centered: true,
          onOk: () => removeAssistant(assistant.id)
        })
      } else {
        window.modal.confirm({
          title: t('assistants.delete.title'),
          content: t('assistants.delete.content'),
          cancelText: t('common.cancel'),
          okText: t('common.confirm'),
          okButtonProps: { danger: true },
          centered: true,
          onOk: () => removeAssistant(assistant.id)
        })
      }
    },
    [removeAssistant, t]
  )

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
      cancelText: t('common.cancel'),
      okText: t('common.confirm'),
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
    if (expandedGroups.has(groupId)) {
      const newSet = new Set(expandedGroups)
      newSet.delete(groupId)
      setExpandedGroups(newSet)
    } else {
      setExpandedGroups(new Set([...expandedGroups, groupId]))
    }
  }

  // 将助手分类：未分组的和按组分类的
  const ungroupedAssistants = assistants.filter(a => !a.groupId)
  
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
      updateAssistantGroup(assistantId, groupId)
    }
    setDragging(false)
    dropTargetRef.current = null
  }

  // 渲染一个分组
  const renderGroup = (group: AssistantGroup) => {
    const groupAssistants = assistants.filter(a => a.groupId === group.id)
    // 删除空组过滤条件，允许显示空组
    const isExpanded = expandedGroups.has(group.id)
    
    return (
      <GroupContainer 
        key={group.id} 
        data-groupid={group.id}
        onDragOver={(e) => handleAssistantDragOver(e, group.id)}
        onDragLeave={handleAssistantDragLeave}
        onDrop={(e) => handleAssistantDrop(e, group.id)}
        className={dropTargetRef.current === group.id ? 'drag-over' : ''}
      >
        <GroupHeader
          onClick={(e) => toggleGroupExpanded(group.id, e)}
          className="group-header-style"
        >
          <GroupTitle>
            <GroupIcon>
              {isExpanded ? <DownOutlined /> : <RightOutlined />}
            </GroupIcon>
            <div>{group.name}</div>
            <GroupCount>{groupAssistants.length}</GroupCount>
          </GroupTitle>
          <GroupActions className="group-actions">
            <EditOutlined onClick={(e) => handleEditGroup(group, e)} />
            <DeleteOutlined 
              className="delete-icon"
              onClick={(e) => { 
                e.stopPropagation(); 
                handleDeleteGroup(group.id); 
              }} 
            />
          </GroupActions>
        </GroupHeader>
        <GroupContent className={isExpanded ? 'expanded' : 'collapsed'}>
          {groupAssistants.map((assistant) => (
            <div 
              key={assistant.id}
              draggable="true"
              onDragStart={(e) => handleAssistantDragStart(e, assistant.id)}
              onDragEnd={handleAssistantDragEnd}
              className="assistant-item-wrapper"
            >
              <AssistantItem
                assistant={assistant}
                isActive={assistant.id === activeAssistant.id}
                onSwitch={setActiveAssistant}
                onDelete={onDelete}
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
    )
  }

  return (
    <Container>
      {/* 未分组的助手 */}
      <UngroupedSection
        onDragOver={(e) => handleAssistantDragOver(e, null)}
        onDragLeave={handleAssistantDragLeave}
        onDrop={(e) => handleAssistantDrop(e, null)}
        className={dropTargetRef.current === null ? 'drag-over' : ''}
      >
        {ungroupedAssistants.map((assistant) => (
          <div 
            key={assistant.id}
            draggable="true"
            onDragStart={(e) => handleAssistantDragStart(e, assistant.id)}
            onDragEnd={handleAssistantDragEnd}
            className="assistant-item-wrapper"
          >
            <AssistantItem
              assistant={assistant}
              isActive={assistant.id === activeAssistant.id}
              onSwitch={setActiveAssistant}
              onDelete={onDelete}
              addAgent={addAgent}
              addAssistant={addAssistant}
              onCreateDefaultAssistant={onCreateDefaultAssistant}
              onMoveToGroup={(assistantId, groupId) => updateAssistantGroup(assistantId, groupId)}
              groups={groups}
            />
          </div>
        ))}
      </UngroupedSection>

      {/* 模块间分割线 */}
      <SectionDivider />

      {/* 分组区域 */}
      <GroupsContainer>
        {groups.map(renderGroup)}
      </GroupsContainer>

      {/* 添加按钮 */}
      <ActionButtons>
        {!dragging && (
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
        )}
      </ActionButtons>

      {/* 创建/编辑分组模态框 */}
      <Modal
        title={currentGroup ? t('assistants.group.edit') : t('assistants.group.add')}
        open={groupModalVisible}
        onOk={handleGroupSubmit}
        onCancel={() => setGroupModalVisible(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label={t('assistants.group.name')}
            rules={[
              {
                required: true,
                message: t('assistants.group.name.required')
              }
            ]}
          >
            <Input placeholder={t('assistants.group.name.placeholder')} />
          </Form.Item>
          <Form.Item name="description" label={t('assistants.group.description')}>
            <Input.TextArea placeholder={t('assistants.group.description.placeholder')} rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </Container>
  )
}

export default Assistants

const Container = styled.div`
  position: relative;
  height: 100%;
  overflow: hidden;
  padding-bottom: 54px; /* 增加底部按钮区域的高度 */
  display: flex;
  flex-direction: column;
  
  .assistant-item-wrapper[draggable="true"] {
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

const UngroupedSection = styled.div`
  padding: 8px;
  border-radius: 8px;
  min-height: 60px;
  
  &.drag-over {
    background-color: var(--color-bg-3);
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
  display: flex;
  gap: 8px;
  opacity: 0;
  visibility: hidden;
  transition: all 0.3s;
  
  svg {
    cursor: pointer;
    font-size: 14px;
    
    &:hover {
      color: var(--color-primary);
    }
  }
  
  /* 删除图标悬停时变为红色 - 提高优先级 */
  .delete-icon:hover {
    color: var(--color-error) !important; /* 使用!important确保优先级 */
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
  padding: 8px 12px 8px 28px;
  display: flex;
  flex-direction: column;
  gap: 4px; /* 减小Assistant间距 */
  
  &.collapsed {
    display: none;
  }
`

const ActionButtons = styled.div`
  display: flex;
  gap: 10px;
  padding: 10px;
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--color-bg-1);
  z-index: 10; /* 提高底部按钮区域的z-index */
  border-top: 1px solid var(--color-border);
  height: 54px; /* 确保按钮区域有足够的高度 */
  box-sizing: border-box;
  
  button {
    flex: 1;
    position: relative;
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
