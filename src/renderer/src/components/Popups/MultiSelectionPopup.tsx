import { CloseOutlined, CopyOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Message } from '@renderer/types/newMessage'
import { Button, Tooltip } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface MultiSelectActionPopupProps {
  visible: boolean
  onClose: () => void
  onAction?: (action: string, messageIds: string[]) => void
  topic: any
}

interface MessageTypeInfo {
  hasUserMessages: boolean
  hasAssistantMessages: boolean
  messageIds: string[]
}

const MultiSelectActionPopup: FC<MultiSelectActionPopupProps> = ({ visible, onClose, onAction }) => {
  const { t } = useTranslation()
  const [, setSelectedMessages] = useState<Message[]>([])
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([])
  const [, setMessageTypeInfo] = useState<MessageTypeInfo>({
    hasUserMessages: false,
    hasAssistantMessages: false,
    messageIds: []
  })

  useEffect(() => {
    const handleSelectedMessagesChanged = (messageIds: string[]) => {
      setSelectedMessageIds(messageIds)
      EventEmitter.emit('REQUEST_SELECTED_MESSAGE_DETAILS', messageIds)
    }

    const handleSelectedMessageDetails = (messages: Message[]) => {
      setSelectedMessages(messages)

      const hasUserMessages = messages.some((msg) => msg.role === 'user')
      const hasAssistantMessages = messages.some((msg) => msg.role === 'assistant')

      setMessageTypeInfo({
        hasUserMessages,
        hasAssistantMessages,
        messageIds: selectedMessageIds
      })
    }

    EventEmitter.on(EVENT_NAMES.SELECTED_MESSAGES_CHANGED, handleSelectedMessagesChanged)
    EventEmitter.on('SELECTED_MESSAGE_DETAILS', handleSelectedMessageDetails)

    return () => {
      EventEmitter.off(EVENT_NAMES.SELECTED_MESSAGES_CHANGED, handleSelectedMessagesChanged)
      EventEmitter.off('SELECTED_MESSAGE_DETAILS', handleSelectedMessageDetails)
    }
  }, [selectedMessageIds])

  const handleAction = (action: string) => {
    if (onAction) {
      onAction(action, selectedMessageIds)
    }
  }

  const handleClose = () => {
    EventEmitter.emit(EVENT_NAMES.MESSAGE_MULTI_SELECT, false)
    onClose()
  }

  if (!visible) return null

  // TODO: 视情况调整
  // const isActionDisabled = selectedMessages.some((msg) => msg.role === 'user')
  const isActionDisabled = false

  return (
    <Container>
      <ActionBar>
        <SelectionCount>{t('common.selectedMessages', { count: selectedMessageIds.length })}</SelectionCount>
        <ActionButtons>
          <Tooltip title={t('common.save')}>
            <ActionButton icon={<SaveOutlined />} disabled={isActionDisabled} onClick={() => handleAction('save')} />
          </Tooltip>
          <Tooltip title={t('common.copy')}>
            <ActionButton icon={<CopyOutlined />} disabled={isActionDisabled} onClick={() => handleAction('copy')} />
          </Tooltip>
          <Tooltip title={t('common.delete')}>
            <ActionButton danger icon={<DeleteOutlined />} onClick={() => handleAction('delete')} />
          </Tooltip>
        </ActionButtons>
        <Tooltip title={t('chat.navigation.close')}>
          <ActionButton icon={<CloseOutlined />} onClick={handleClose} />
        </Tooltip>
      </ActionBar>
    </Container>
  )
}

const Container = styled.div`
  position: sticky;
  bottom: 0;
  left: 0;
  width: 100%;
  padding: 36px 20px;
  background-color: var(--color-background);
  border-top: 1px solid var(--color-border);
  z-index: 10;
`

const ActionBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`

const ActionButtons = styled.div`
  display: flex;
  gap: 16px;
`

const ActionButton = styled(Button)`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  border-radius: 4px;
  .anticon {
    font-size: 16px;
  }
  &:hover {
    background-color: var(--color-background-mute);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

const SelectionCount = styled.div`
  margin-right: 15px;
  color: var(--color-text-2);
  font-size: 14px;
`

export default MultiSelectActionPopup
