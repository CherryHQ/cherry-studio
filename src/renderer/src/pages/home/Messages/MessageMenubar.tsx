import { InfoCircleOutlined } from '@ant-design/icons'
import { CopyIcon, DeleteIcon, EditIcon, RefreshIcon } from '@renderer/components/Icons'
import SaveToKnowledgePopup from '@renderer/components/Popups/SaveToKnowledgePopup'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useExportActions } from '@renderer/hooks/useExportsActions'
import { useMessageActions } from '@renderer/hooks/useMessageActions'
import { useMessageOperations, useTopicLoading } from '@renderer/hooks/useMessageOperations'
import { useEnableDeveloperMode, useMessageStyle } from '@renderer/hooks/useSettings'
import useTranslate from '@renderer/hooks/useTranslate'
import { useTranslationActions } from '@renderer/hooks/useTranslationActions'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import { TraceIcon } from '@renderer/trace/pages/Component'
import type { Assistant, Model, Topic } from '@renderer/types'
import { type Message } from '@renderer/types/newMessage'
import { classNames } from '@renderer/utils'
// import { withMessageThought } from '@renderer/utils/formats'
import { findMainTextBlocks } from '@renderer/utils/messageUtils/find'
import { Dropdown, Popconfirm, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { AtSign, Check, FilePenLine, Languages, ListChecks, Menu, Save, Split, ThumbsUp, Upload } from 'lucide-react'
import { FC, memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import MessageTokens from './MessageTokens'

interface Props {
  message: Message
  assistant: Assistant
  topic: Topic
  model?: Model
  index?: number
  isGrouped?: boolean
  isLastMessage: boolean
  isAssistantMessage: boolean
  messageContainerRef: React.RefObject<HTMLDivElement>
  setModel: (model: Model) => void
  onUpdateUseful?: (msgId: string) => void
}

const MessageMenubar: FC<Props> = (props) => {
  const {
    message,
    index,
    isGrouped,
    isLastMessage,
    isAssistantMessage,
    assistant,
    topic,
    model,
    messageContainerRef,
    onUpdateUseful
  } = props
  const { t } = useTranslation()
  const { toggleMultiSelectMode } = useChatContext(props.topic)
  const [showRegenerateTooltip, setShowRegenerateTooltip] = useState(false)
  const [showDeleteTooltip, setShowDeleteTooltip] = useState(false)
  const { translateLanguages } = useTranslate()
  const { removeMessageBlock } = useMessageOperations(topic)
  const {
    copied,
    handleCopy,
    handleEdit,
    handleRegenerate,
    handleAssistantRegenerate,
    handleTraceUserMessage,
    handleDeleteMessage,
    handleMentionModel
  } = useMessageActions(message, topic, assistant)
  const { hasTranslationBlocks, mainTextContent, handleTranslate } = useTranslationActions(message, topic)
  const { exportMenuItems } = useExportActions(message, topic, messageContainerRef)

  const { isBubbleStyle } = useMessageStyle()
  const { enableDeveloperMode } = useEnableDeveloperMode()

  const loading = useTopicLoading(topic)

  const isUserMessage = message.role === 'user'

  // const processedMessage = useMemo(() => {
  //   if (message.role === 'assistant' && message.model && isReasoningModel(message.model)) {
  //     return withMessageThought(message)
  //   }
  //   return message
  // }, [message])

  const onNewBranch = useCallback(async () => {
    if (loading) return
    EventEmitter.emit(EVENT_NAMES.NEW_BRANCH, index)
    window.message.success({ content: t('chat.message.new.branch.created'), key: 'new-branch' })
  }, [index, t, loading])

  const isEditable = useMemo(() => {
    return findMainTextBlocks(message).length > 0 // 使用 MCP Server 后会有大于一段 MatinTextBlock
  }, [message])

  const dropdownItems = useMemo(
    () => [
      ...(isEditable
        ? [
            {
              label: t('common.edit'),
              key: 'edit',
              icon: <FilePenLine size={15} />,
              onClick: handleEdit
            }
          ]
        : []),
      {
        label: t('chat.message.new.branch.label'),
        key: 'new-branch',
        icon: <Split size={15} />,
        onClick: onNewBranch
      },
      {
        label: t('chat.multiple.select.label'),
        key: 'multi-select',
        icon: <ListChecks size={15} />,
        onClick: () => {
          toggleMultiSelectMode(true)
        }
      },
      {
        label: t('chat.save.label'),
        key: 'save',
        icon: <Save size={15} />,
        children: [
          {
            label: t('chat.save.file.title'),
            key: 'file',
            onClick: () => {
              const fileName = dayjs(message.createdAt).format('YYYYMMDDHHmm') + '.md'
              window.api.file.save(fileName, mainTextContent)
            }
          },
          {
            label: t('chat.save.knowledge.title'),
            key: 'knowledge',
            onClick: () => {
              SaveToKnowledgePopup.showForMessage(message)
            }
          }
        ]
      },
      {
        label: t('chat.topics.export.title'),
        key: 'export',
        icon: <Upload size={15} />,
        children: exportMenuItems
      }
    ],
    [
      t,
      isEditable,
      handleEdit,
      onNewBranch,
      exportMenuItems,
      message,
      mainTextContent,
      toggleMultiSelectMode,
      messageContainerRef,
      topic.name
    ]
  )

  const onUseful = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onUpdateUseful?.(message.id)
    },
    [message.id, onUpdateUseful]
  )

  const blockEntities = useSelector(messageBlocksSelectors.selectEntities)

  const softHoverBg = isBubbleStyle && !isLastMessage
  const showMessageTokens = !isBubbleStyle
  const isUserBubbleStyleMessage = isBubbleStyle && isUserMessage

  return (
    <>
      {showMessageTokens && <MessageTokens message={message} />}
      <MenusBar
        className={classNames({ menubar: true, show: isLastMessage, 'user-bubble-style': isUserBubbleStyleMessage })}>
        {message.role === 'user' && (
          <Tooltip title={t('common.regenerate')} mouseEnterDelay={0.8}>
            <ActionButton
              className="message-action-button"
              onClick={() => handleRegenerate()}
              $softHoverBg={isBubbleStyle}>
              <RefreshIcon size={15} />
            </ActionButton>
          </Tooltip>
        )}
        {message.role === 'user' && (
          <Tooltip title={t('common.edit')} mouseEnterDelay={0.8}>
            <ActionButton className="message-action-button" onClick={handleEdit} $softHoverBg={softHoverBg}>
              <EditIcon size={15} />
            </ActionButton>
          </Tooltip>
        )}
        <Tooltip title={t('common.copy')} mouseEnterDelay={0.8}>
          <ActionButton className="message-action-button" onClick={handleCopy} $softHoverBg={softHoverBg}>
            {!copied && <CopyIcon size={15} />}
            {copied && <Check size={15} color="var(--color-primary)" />}
          </ActionButton>
        </Tooltip>
        {isAssistantMessage && (
          <Popconfirm
            title={t('message.regenerate.confirm')}
            okButtonProps={{ danger: true }}
            icon={<InfoCircleOutlined style={{ color: 'red' }} />}
            onConfirm={handleAssistantRegenerate}
            onOpenChange={(open) => open && setShowRegenerateTooltip(false)}>
            <Tooltip
              title={t('common.regenerate')}
              mouseEnterDelay={0.8}
              open={showRegenerateTooltip}
              onOpenChange={setShowRegenerateTooltip}>
              <ActionButton className="message-action-button" $softHoverBg={softHoverBg}>
                <RefreshIcon size={15} />
              </ActionButton>
            </Tooltip>
          </Popconfirm>
        )}
        {isAssistantMessage && (
          <Tooltip title={t('message.mention.title')} mouseEnterDelay={0.8}>
            <ActionButton
              className="message-action-button"
              onClick={(e) => handleMentionModel(e, model)}
              $softHoverBg={softHoverBg}>
              <AtSign size={15} />
            </ActionButton>
          </Tooltip>
        )}
        {!isUserMessage && (
          <Dropdown
            menu={{
              style: {
                maxHeight: 250,
                overflowY: 'auto',
                backgroundClip: 'border-box'
              },
              items: [
                ...translateLanguages.map((item) => ({
                  label: item.emoji + ' ' + item.label(),
                  key: item.langCode,
                  onClick: () => handleTranslate(item)
                })),
                ...(hasTranslationBlocks
                  ? [
                      { type: 'divider' as const },
                      {
                        label: '📋 ' + t('common.copy'),
                        key: 'translate-copy',
                        onClick: () => {
                          const translationBlocks = message.blocks
                            .map((blockId) => blockEntities[blockId])
                            .filter((block) => block?.type === 'translation')

                          if (translationBlocks.length > 0) {
                            const translationContent = translationBlocks
                              .map((block) => block?.content || '')
                              .join('\n\n')
                              .trim()

                            if (translationContent) {
                              navigator.clipboard.writeText(translationContent)
                              window.message.success({ content: t('translate.copied'), key: 'translate-copy' })
                            } else {
                              window.message.warning({ content: t('translate.empty'), key: 'translate-copy' })
                            }
                          }
                        }
                      },
                      {
                        label: '✖ ' + t('translate.close'),
                        key: 'translate-close',
                        onClick: () => {
                          const translationBlocks = message.blocks
                            .map((blockId) => blockEntities[blockId])
                            .filter((block) => block?.type === 'translation')
                            .map((block) => block?.id)

                          if (translationBlocks.length > 0) {
                            translationBlocks.forEach((blockId) => {
                              if (blockId) removeMessageBlock(message.id, blockId)
                            })
                            window.message.success({ content: t('translate.closed'), key: 'translate-close' })
                          }
                        }
                      }
                    ]
                  : [])
              ],
              onClick: (e) => e.domEvent.stopPropagation()
            }}
            trigger={['click']}
            placement="top"
            arrow>
            <Tooltip title={t('chat.translate')} mouseEnterDelay={1.2}>
              <ActionButton
                className="message-action-button"
                onClick={(e) => e.stopPropagation()}
                $softHoverBg={softHoverBg}>
                <Languages size={15} />
              </ActionButton>
            </Tooltip>
          </Dropdown>
        )}
        {isAssistantMessage && isGrouped && (
          <Tooltip title={t('chat.message.useful.label')} mouseEnterDelay={0.8}>
            <ActionButton className="message-action-button" onClick={onUseful} $softHoverBg={softHoverBg}>
              {message.useful ? (
                <ThumbsUp size={17.5} fill="var(--color-primary)" strokeWidth={0} />
              ) : (
                <ThumbsUp size={15} />
              )}
            </ActionButton>
          </Tooltip>
        )}
        <Popconfirm
          title={t('message.message.delete.content')}
          okButtonProps={{ danger: true }}
          icon={<InfoCircleOutlined style={{ color: 'red' }} />}
          onOpenChange={(open) => open && setShowDeleteTooltip(false)}
          onConfirm={handleDeleteMessage}>
          <ActionButton
            className="message-action-button"
            onClick={(e) => e.stopPropagation()}
            $softHoverBg={softHoverBg}>
            <Tooltip
              title={t('common.delete')}
              mouseEnterDelay={1}
              open={showDeleteTooltip}
              onOpenChange={setShowDeleteTooltip}>
              <DeleteIcon size={15} />
            </Tooltip>
          </ActionButton>
        </Popconfirm>
        {enableDeveloperMode && message.traceId && (
          <Tooltip title={t('trace.label')} mouseEnterDelay={0.8}>
            <ActionButton className="message-action-button" onClick={() => handleTraceUserMessage()}>
              <TraceIcon size={16} className={'lucide lucide-trash'} />
            </ActionButton>
          </Tooltip>
        )}
        {!isUserMessage && (
          <Dropdown
            menu={{ items: dropdownItems, onClick: (e) => e.domEvent.stopPropagation() }}
            trigger={['click']}
            placement="topRight">
            <ActionButton
              className="message-action-button"
              onClick={(e) => e.stopPropagation()}
              $softHoverBg={softHoverBg}>
              <Menu size={19} />
            </ActionButton>
          </Dropdown>
        )}
      </MenusBar>
    </>
  )
}

const MenusBar = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;

  &.user-bubble-style {
    margin-top: 5px;
  }
`

const ActionButton = styled.div<{ $softHoverBg?: boolean }>`
  cursor: pointer;
  border-radius: 8px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  width: 26px;
  height: 26px;
  transition: all 0.2s ease;
  &:hover {
    background-color: ${(props) =>
      props.$softHoverBg ? 'var(--color-background-soft)' : 'var(--color-background-mute)'};
    color: var(--color-text-1);
    .anticon,
    .lucide {
      color: var(--color-text-1);
    }
  }
  .anticon,
  .iconfont {
    cursor: pointer;
    font-size: 14px;
    color: var(--color-icon);
  }
  .icon-at {
    font-size: 16px;
  }
`

// const ReSendButton = styled(Button)`
//   position: absolute;
//   top: 10px;
//   left: 0;
// `

export default memo(MessageMenubar)
