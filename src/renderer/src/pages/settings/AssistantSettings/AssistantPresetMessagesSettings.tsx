import {
  DeleteOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  HistoryOutlined,
  PlusOutlined,
  RobotOutlined,
  UserOutlined
} from '@ant-design/icons'
import { DraggableList } from '@renderer/components/DraggableList'
import FileItem from '@renderer/pages/files/FileItem'
import { Assistant, AssistantMessage } from '@renderer/types'
import { Button, Flex, Input, Modal, Popconfirm, Select, Space, Switch } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { v4 as uuidv4 } from 'uuid'

import { SettingDivider, SettingRow, SettingTitle } from '..'

const { TextArea } = Input

interface AssistantPresetMessagesSettingsProps {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
}

const AssistantPresetMessagesSettings: FC<AssistantPresetMessagesSettingsProps> = ({ assistant, updateAssistant }) => {
  const { t } = useTranslation()
  const [messagesList, setMessagesList] = useState<AssistantMessage[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingMessage, setEditingMessage] = useState<AssistantMessage | null>(null)
  const [formData, setFormData] = useState<Omit<AssistantMessage, 'id'>>({ role: 'user', content: '' })
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    // 确保所有消息都有唯一ID，并且存在聊天记录占位符
    const CHAT_HISTORY_PLACEHOLDER_ID = 'chat-history-placeholder'

    // 从助手对象获取消息列表
    let existingMessages = [...(assistant.messages || [])]

    // 检查是否已存在聊天记录占位符
    const hasHistoryPlaceholder = existingMessages.some((msg) => msg.type === 'chat_history')

    // 如果不存在，创建一个
    if (!hasHistoryPlaceholder) {
      const historyPlaceholder: AssistantMessage = {
        id: CHAT_HISTORY_PLACEHOLDER_ID,
        role: 'system',
        content: 'Chat History',
        type: 'chat_history',
        enabled: true
      }
      // 将占位符添加到列表中
      existingMessages = [historyPlaceholder, ...existingMessages]
    }

    // 确保所有消息都有唯一ID
    const messagesWithIds = existingMessages.map((msg) => ({
      ...msg,
      id: msg.id || uuidv4()
    }))

    setMessagesList(messagesWithIds)

    // 如果我们添加了占位符，更新助手对象
    if (!hasHistoryPlaceholder) {
      updateAssistant({ ...assistant, messages: messagesWithIds })
    }
  }, [assistant.messages, updateAssistant, assistant])

  const handleAdd = () => {
    setEditingMessage(null)
    setFormData({ role: 'user', content: '' })
    setIsModalOpen(true)
  }

  const handleEdit = (message: AssistantMessage) => {
    // 不允许编辑聊天记录占位符
    if (message.type === 'chat_history') return

    setEditingMessage(message)
    setFormData({ role: message.role, content: message.content })
    setIsModalOpen(true)
  }

  const handleDelete = async (id: string) => {
    // 不允许删除聊天记录占位符
    const messageToDelete = messagesList.find((msg) => msg.id === id)
    if (messageToDelete?.type === 'chat_history') return

    const updatedMessages = messagesList.filter((msg) => msg.id !== id)
    setMessagesList(updatedMessages)
    updateAssistant({ ...assistant, messages: updatedMessages })
  }

  const handleModalOk = async () => {
    if (!formData.content.trim()) {
      return
    }

    let updatedMessages: AssistantMessage[]
    if (editingMessage) {
      updatedMessages = messagesList.map((msg) =>
        msg.id === editingMessage.id ? { ...editingMessage, ...formData } : msg
      )
    } else {
      const newMessage: AssistantMessage = {
        id: uuidv4(),
        ...formData,
        type: 'message' // 明确标记为普通消息
      }
      updatedMessages = [...messagesList, newMessage]
    }
    setMessagesList(updatedMessages)
    updateAssistant({ ...assistant, messages: updatedMessages })
    setIsModalOpen(false)
  }

  const handleUpdateOrder = async (newMessages: AssistantMessage[]) => {
    setMessagesList(newMessages)
    updateAssistant({ ...assistant, messages: newMessages })
  }

  const handleToggleHistory = (checked: boolean) => {
    const updatedMessages = messagesList.map((msg) =>
      msg.type === 'chat_history' ? { ...msg, enabled: checked } : msg
    )
    setMessagesList(updatedMessages)
    updateAssistant({ ...assistant, messages: updatedMessages })
  }

  return (
    <Container>
      <SettingTitle>
        {t('assistants.settings.preset_messages.title', 'Preset Messages')}
        <Button type="text" icon={<PlusOutlined />} onClick={handleAdd} />
      </SettingTitle>
      <SettingDivider />
      <SettingRow>
        <StyledPromptList>
          <DraggableList
            list={messagesList}
            onUpdate={handleUpdateOrder}
            style={{ paddingBottom: dragging ? '34px' : 0 }}
            onDragStart={() => setDragging(true)}
            onDragEnd={() => setDragging(false)}>
            {(message) => {
              // 特殊处理聊天记录占位符
              if (message.type === 'chat_history') {
                return (
                  <FileItem
                    key={message.id}
                    fileInfo={{
                      name: t('assistants.settings.preset_messages.chatHistory', 'Chat History'),
                      ext: '',
                      extra: t(
                        'assistants.settings.preset_messages.chatHistoryDesc',
                        'The actual conversation records will be inserted here.'
                      ),
                      icon: <HistoryOutlined />,
                      actions: (
                        <Switch
                          checked={message.enabled !== false} // 默认为true
                          onChange={handleToggleHistory}
                          size="small"
                          style={{ marginRight: 8 }}
                        />
                      )
                    }}
                    style={{ backgroundColor: 'var(--color-background-soft)' }}
                  />
                )
              }

              // 普通预设消息
              return (
                <FileItem
                  key={message.id}
                  fileInfo={{
                    name:
                      message.role === 'user'
                        ? t('assistants.settings.preset_messages.userMessage', 'User Message')
                        : message.role === 'assistant'
                          ? t('assistants.settings.preset_messages.assistantMessage', 'Assistant Message')
                          : t('assistants.settings.preset_messages.systemMessage', 'System Message'),
                    ext: '',
                    extra: message.content,
                    icon:
                      message.role === 'user' ? (
                        <UserOutlined />
                      ) : message.role === 'assistant' ? (
                        <RobotOutlined />
                      ) : (
                        <HistoryOutlined />
                      ),
                    actions: (
                      <Flex gap={4} style={{ opacity: 0.6 }}>
                        <Button key="edit" type="text" icon={<EditOutlined />} onClick={() => handleEdit(message)} />
                        <Popconfirm
                          title={t('assistants.settings.preset_messages.delete', 'Delete Message')}
                          description={t(
                            'assistants.settings.preset_messages.deleteConfirm',
                            'Are you sure to delete this message?'
                          )}
                          okText={t('common.confirm')}
                          cancelText={t('common.cancel')}
                          onConfirm={() => handleDelete(message.id!)}
                          icon={<ExclamationCircleOutlined style={{ color: 'red' }} />}>
                          <Button key="delete" type="text" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      </Flex>
                    )
                  }}
                />
              )
            }}
          </DraggableList>
        </StyledPromptList>
      </SettingRow>

      <Modal
        title={
          editingMessage
            ? t('assistants.settings.preset_messages.edit', 'Edit Message')
            : t('assistants.settings.preset_messages.add', 'Add Message')
        }
        open={isModalOpen}
        onOk={handleModalOk}
        onCancel={() => setIsModalOpen(false)}
        width={520}
        transitionName="animation-move-down"
        centered>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Label>{t('assistants.settings.preset_messages.roleLabel', 'Role')}</Label>
            <Select
              value={formData.role}
              onChange={(value) => setFormData({ ...formData, role: value })}
              style={{ width: '100%' }}
              options={[
                { value: 'user', label: t('assistants.settings.preset_messages.roleUser', 'User') },
                { value: 'assistant', label: t('assistants.settings.preset_messages.roleAssistant', 'Assistant') },
                { value: 'system', label: t('assistants.settings.preset_messages.roleSystem', 'System') }
              ]}
            />
          </div>
          <div>
            <Label>{t('assistants.settings.preset_messages.contentLabel', 'Content')}</Label>
            <TextArea
              placeholder={t('assistants.settings.preset_messages.contentPlaceholder', 'Enter content')}
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              rows={6}
              style={{ resize: 'none' }}
            />
          </div>
        </Space>
      </Modal>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
`

const Label = styled.div`
  font-size: 14px;
  color: var(--color-text);
  margin-bottom: 8px;
`

const StyledPromptList = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
`

export default AssistantPresetMessagesSettings
