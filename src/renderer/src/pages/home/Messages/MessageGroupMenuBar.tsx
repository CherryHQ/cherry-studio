import {
  ColumnHeightOutlined,
  ColumnWidthOutlined,
  DeleteOutlined,
  FolderOutlined,
  NumberOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { RowFlex } from '@cherrystudio/ui'
import { Button, Tooltip } from '@cherrystudio/ui'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useMessageOperations } from '@renderer/hooks/useMessageOperations'
import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { AssistantMessageStatus } from '@renderer/types/newMessage'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import type { MultiModelMessageStyle } from '@shared/data/preference/preferenceTypes'
import type { FC } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import MessageGroupModelList from './MessageGroupModelList'
import MessageGroupSettings from './MessageGroupSettings'

interface Props {
  multiModelMessageStyle: MultiModelMessageStyle
  setMultiModelMessageStyle: (style: MultiModelMessageStyle) => void
  messages: Message[]
  selectMessageId: string
  setSelectedMessage: (message: Message) => void
  topic: Topic
}

const MessageGroupMenuBar: FC<Props> = ({
  multiModelMessageStyle,
  setMultiModelMessageStyle,
  messages,
  selectMessageId,
  setSelectedMessage,
  topic
}) => {
  const { t } = useTranslation()
  const { deleteGroupMessages, regenerateAssistantMessage } = useMessageOperations(topic)
  const { assistant } = useAssistant(messages[0]?.assistantId)

  const handleDeleteGroup = async () => {
    const askId = messages[0]?.askId
    if (!askId) return

    window.modal.confirm({
      title: t('message.group.delete.title'),
      content: t('message.group.delete.content'),
      centered: true,
      okButtonProps: {
        danger: true
      },
      okText: t('common.delete'),
      onOk: () => deleteGroupMessages(askId)
    })
  }

  const isFailedMessage = (m: Message) => {
    if (m.role !== 'assistant') return false
    const isError = (m.status || '').toLowerCase() === 'error'
    const content = getMainTextContent(m)
    const noContent = !content || content.trim().length === 0
    const noBlocks = !m.blocks || m.blocks.length === 0
    return isError || noContent || noBlocks
  }

  const isTransmittingMessage = (m: Message) => {
    if (m.role !== 'assistant') return false
    const status = m.status as AssistantMessageStatus
    return (
      status === AssistantMessageStatus.PROCESSING ||
      status === AssistantMessageStatus.PENDING ||
      status === AssistantMessageStatus.SEARCHING
    )
  }

  const hasFailedMessages = messages.some((m) => isFailedMessage(m) && !isTransmittingMessage(m))

  const handleRetryAll = async () => {
    const candidates = messages.filter((m) => isFailedMessage(m) && !isTransmittingMessage(m))

    for (const msg of candidates) {
      try {
        await regenerateAssistantMessage(msg, assistant)
      } catch (e) {
        // swallow per-item errors to continue others
      }
    }
  }

  const multiModelMessageStyleTextByLayout = {
    fold: t('message.message.multi_model_style.fold.label'),
    vertical: t('message.message.multi_model_style.vertical'),
    horizontal: t('message.message.multi_model_style.horizontal'),
    grid: t('message.message.multi_model_style.grid')
  } as const

  return (
    <GroupMenuBar $layout={multiModelMessageStyle} className="group-menu-bar">
      <RowFlex className="flex-1 items-center overflow-hidden">
        <LayoutContainer>
          {(['fold', 'vertical', 'horizontal', 'grid'] as const).map((layout) => (
            <Tooltip
              key={layout}
              placement="top"
              content={
                t('message.message.multi_model_style.label') + ': ' + multiModelMessageStyleTextByLayout[layout]
              }>
              <LayoutOption
                $active={multiModelMessageStyle === layout}
                onClick={() => setMultiModelMessageStyle(layout)}>
                {layout === 'fold' ? (
                  <FolderOutlined />
                ) : layout === 'horizontal' ? (
                  <ColumnWidthOutlined />
                ) : layout === 'vertical' ? (
                  <ColumnHeightOutlined />
                ) : (
                  <NumberOutlined />
                )}
              </LayoutOption>
            </Tooltip>
          ))}
        </LayoutContainer>
        {multiModelMessageStyle === 'fold' && (
          <MessageGroupModelList
            messages={messages}
            selectMessageId={selectMessageId}
            setSelectedMessage={setSelectedMessage}
          />
        )}
        {multiModelMessageStyle === 'grid' && <MessageGroupSettings />}
      </RowFlex>
      {hasFailedMessages && (
        <Tooltip placement="top" content={t('message.group.retry_failed')}>
          <Button
            variant="light"
            size="sm"
            startContent={<ReloadOutlined />}
            onPress={handleRetryAll}
            className="mr-1"
          />
        </Tooltip>
      )}
      <Button
        variant="light"
        size="sm"
        startContent={<DeleteOutlined style={{ color: 'var(--color-error)' }} />}
        onPress={handleDeleteGroup}
      />
    </GroupMenuBar>
  )
}

const GroupMenuBar = styled.div<{ $layout: MultiModelMessageStyle }>`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 10px;
  margin: 8px 10px 16px;
  justify-content: space-between;
  overflow: hidden;
  border: 0.5px solid var(--color-border);
  height: 40px;
`

const LayoutContainer = styled.div`
  display: flex;
  gap: 4px;
  flex-direction: row;
`

const LayoutOption = styled.div<{ $active: boolean }>`
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  background-color: ${({ $active }) => ($active ? 'var(--color-background-soft)' : 'transparent')};

  &:hover {
    background-color: ${({ $active }) => ($active ? 'var(--color-background-soft)' : 'var(--color-hover)')};
  }
`

export default memo(MessageGroupMenuBar)
