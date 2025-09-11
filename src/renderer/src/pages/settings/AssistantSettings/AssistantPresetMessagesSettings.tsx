import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  RobotOutlined,
  UploadOutlined,
  UserOutlined
} from '@ant-design/icons'
import { DraggableList } from '@renderer/components/DraggableList'
import FileItem from '@renderer/pages/files/FileItem'
import { Assistant, AssistantMessage } from '@renderer/types'
import { Button, Flex, Input, message, Modal, Popconfirm, Radio, Space, Switch } from 'antd'
import { FC, useEffect, useRef, useState } from 'react'
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
  const [listHeight, setListHeight] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const promptListRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 计算可用高度并设置列表高度
  useEffect(() => {
    const calculateHeight = () => {
      if (containerRef.current && promptListRef.current) {
        // 获取容器的位置信息
        const containerRect = containerRef.current.getBoundingClientRect()
        // 计算可用高度 (考虑标题和分隔线的高度，以及底部的边距)
        const availableHeight = window.innerHeight - containerRect.top - 40 // 40px 作为底部边距
        // 设置列表高度
        setListHeight(Math.max(300, availableHeight)) // 最小高度为 300px
      }
    }

    // 初始计算
    calculateHeight()

    // 监听窗口大小变化
    window.addEventListener('resize', calculateHeight)

    // 清理函数
    return () => {
      window.removeEventListener('resize', calculateHeight)
    }
  }, [])

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
      // 将占位符添加到列表末尾，这样聊天记录默认会被插入到底部
      existingMessages = [...existingMessages, historyPlaceholder]
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
        type: 'message', // 明确标记为普通消息
        enabled: true
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

  const handleExport = () => {
    const assistantName = assistant.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const filename = `${assistantName}_presets_${timestamp}.json`

    // 导出时不包含临时的 'id'，使其更具可移植性
    const messagesToExport = messagesList.map(({ id, ...rest }) => rest)

    const jsonString = JSON.stringify(messagesToExport, null, 2)
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    message.success(t('assistants.settings.preset_messages.exportSuccess', 'Presets exported successfully'))
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string
        const importedMessages = JSON.parse(content)

        // 简单的验证，确保是消息数组
        if (!Array.isArray(importedMessages) || !importedMessages.every((msg) => 'role' in msg && 'content' in msg)) {
          throw new Error('Invalid file format')
        }

        // 为导入的消息添加唯一ID，以确保拖拽等功能正常
        const messagesWithIds = importedMessages.map((msg: Omit<AssistantMessage, 'id'>) => ({
          ...msg,
          id: uuidv4()
        }))

        setMessagesList(messagesWithIds)
        updateAssistant({ ...assistant, messages: messagesWithIds })
        message.success(t('assistants.settings.preset_messages.importSuccess', 'Presets imported successfully'))
      } catch (error) {
        message.error(t('assistants.settings.preset_messages.importError', 'Failed to import presets. Invalid file.'))
        console.error('Import failed:', error)
      } finally {
        // 重置文件输入，以便可以再次选择相同的文件
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    }
    reader.readAsText(file)
  }

  const handleToggleHistory = (checked: boolean) => {
    const updatedMessages = messagesList.map((msg) =>
      msg.type === 'chat_history' ? { ...msg, enabled: checked } : msg
    )
    setMessagesList(updatedMessages)
    updateAssistant({ ...assistant, messages: updatedMessages })
  }

  const handleToggleMessage = (id: string, checked: boolean) => {
    const updatedMessages = messagesList.map((msg) => (msg.id === id ? { ...msg, enabled: checked } : msg))
    setMessagesList(updatedMessages)
    updateAssistant({ ...assistant, messages: updatedMessages })
  }

  return (
    <Container ref={containerRef}>
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept=".json"
        onChange={handleFileSelect}
        title={t('common.import', 'Import')}
      />
      <SettingTitle>
        {t('assistants.settings.preset_messages.title', 'Preset Messages')}
        <Space style={{ marginLeft: '8px' }}>
          <Button
            type="default"
            size="small"
            icon={<DownloadOutlined />}
            onClick={handleImportClick}
            style={{ borderRadius: '4px' }}>
            {t('common.import', 'Import')}
          </Button>
          <Button
            type="default"
            size="small"
            icon={<UploadOutlined />}
            onClick={handleExport}
            style={{ borderRadius: '4px' }}>
            {t('common.export', 'Export')}
          </Button>
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            onClick={handleAdd}
            style={{ borderRadius: '4px' }}
          />
        </Space>
      </SettingTitle>
      <SettingDivider />
      <SettingRow style={{ overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <StyledPromptList ref={promptListRef} style={{ height: listHeight ? `${listHeight}px` : 'auto' }}>
          <DraggableList
            list={messagesList}
            onUpdate={handleUpdateOrder}
            style={{
              paddingBottom: dragging ? '34px' : 0,
              paddingRight: '4px' // 为滚动条预留空间
            }}
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
                      icon: <HistoryOutlined style={{ color: 'var(--color-primary)' }} />,
                      actions: (
                        <Switch
                          checked={message.enabled !== false} // 默认为true
                          onChange={handleToggleHistory}
                          size="small"
                          style={{ marginRight: 8 }}
                        />
                      )
                    }}
                    style={{
                      backgroundColor: 'var(--color-background-soft)',
                      borderRadius: '6px',
                      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)'
                    }}
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
                    extra: message.content.length > 120 ? `${message.content.substring(0, 120)}...` : message.content,
                    icon:
                      message.role === 'user' ? (
                        <UserOutlined style={{ color: 'var(--color-info)' }} />
                      ) : message.role === 'assistant' ? (
                        <RobotOutlined style={{ color: 'var(--color-success)' }} />
                      ) : (
                        <InfoCircleOutlined style={{ color: 'var(--color-warning)' }} />
                      ),
                    actions: (
                      <Flex gap={8} align="center">
                        <Switch
                          checked={message.enabled !== false}
                          onChange={(checked) => handleToggleMessage(message.id!, checked)}
                          size="small"
                        />
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
                      </Flex>
                    )
                  }}
                  style={{
                    borderRadius: '6px',
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                    transition: 'all 0.2s ease',
                    opacity: message.enabled !== false ? 1 : 0.6
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
        width={800}
        transitionName="animation-move-down"
        centered
        okButtonProps={{ style: { borderRadius: '4px' } }}
        cancelButtonProps={{ style: { borderRadius: '4px' } }}
        styles={{ mask: { backdropFilter: 'blur(2px)' } }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Label>{t('assistants.settings.preset_messages.roleLabel', 'Role')}</Label>
            <Radio.Group
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              buttonStyle="solid">
              <Radio.Button value="user">{t('assistants.settings.preset_messages.roleUser', 'User')}</Radio.Button>
              <Radio.Button value="assistant">
                {t('assistants.settings.preset_messages.roleAssistant', 'Assistant')}
              </Radio.Button>
              <Radio.Button value="system">
                {t('assistants.settings.preset_messages.roleSystem', 'System')}
              </Radio.Button>
            </Radio.Group>
          </div>
          <div>
            <Label>{t('assistants.settings.preset_messages.contentLabel', 'Content')}</Label>
            <TextArea
              placeholder={t('assistants.settings.preset_messages.contentPlaceholder', 'Enter content')}
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              rows={16}
              style={{
                resize: 'none',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '14px',
                transition: 'all 0.3s ease'
              }}
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
  height: 100%;
  overflow: hidden;
`

const Label = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
`

const StyledPromptList = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  padding: 2px;
  flex: 1;
  min-height: 300px; /* 最小高度 */

  /* 自定义滚动条样式 */
  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: var(--color-background-soft);
    border-radius: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 4px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: var(--color-border-hover, #aaa);
  }
`

export default AssistantPresetMessagesSettings
