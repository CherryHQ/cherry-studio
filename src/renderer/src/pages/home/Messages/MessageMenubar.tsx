// import { InfoCircleOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { CopyIcon, DeleteIcon, EditIcon, RefreshIcon } from '@renderer/components/Icons'
import ObsidianExportPopup from '@renderer/components/Popups/ObsidianExportPopup'
import SaveToKnowledgePopup from '@renderer/components/Popups/SaveToKnowledgePopup'
import SelectModelPopup from '@renderer/components/Popups/SelectModelPopup'
import { isEmbeddingModel, isRerankModel, isVisionModel } from '@renderer/config/models'
import { useMessageEditing } from '@renderer/context/MessageEditingContext'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useMessageOperations } from '@renderer/hooks/useMessageOperations'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { useEnableDeveloperMode, useMessageStyle, useSettings } from '@renderer/hooks/useSettings'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import useTranslate from '@renderer/hooks/useTranslate'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getMessageTitle } from '@renderer/services/MessagesService'
import { translateText } from '@renderer/services/TranslateService'
import store, { RootState, useAppDispatch } from '@renderer/store'
import { messageBlocksSelectors, removeOneBlock } from '@renderer/store/messageBlock'
import { selectMessagesForTopic } from '@renderer/store/newMessage'
import { TraceIcon } from '@renderer/trace/pages/Component'
import type { Assistant, Model, Topic, TranslateLanguage } from '@renderer/types'
import { type Message, MessageBlockType } from '@renderer/types/newMessage'
import { captureScrollableAsBlob, captureScrollableAsDataURL, classNames } from '@renderer/utils'
import { copyMessageAsPlainText } from '@renderer/utils/copy'
import {
  exportMarkdownToJoplin,
  exportMarkdownToSiyuan,
  exportMarkdownToYuque,
  exportMessageAsMarkdown,
  exportMessageToNotes,
  exportMessageToNotion,
  messageToMarkdown
} from '@renderer/utils/export'
// import { withMessageThought } from '@renderer/utils/formats'
import { removeTrailingDoubleSpaces } from '@renderer/utils/markdown'
import {
  findMainTextBlocks,
  findTranslationBlocks,
  findTranslationBlocksById,
  getMainTextContent
} from '@renderer/utils/messageUtils/find'
import { Dropdown, Popconfirm, Tooltip } from 'antd'
import dayjs from 'dayjs'
import {
  AtSign,
  Check,
  FilePenLine,
  Languages,
  ListChecks,
  Menu,
  NotebookPen,
  Save,
  Split,
  ThumbsUp,
  Upload
} from 'lucide-react'
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

const logger = loggerService.withContext('MessageMenubar')

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
  const { notesPath } = useNotesSettings()
  const { toggleMultiSelectMode } = useChatContext(props.topic)
  const [copied, setCopied] = useTemporaryValue(false, 2000)
  const [isTranslating, setIsTranslating] = useState(false)
  // remove confirm for regenerate; tooltip stays simple
  const [showDeleteTooltip, setShowDeleteTooltip] = useState(false)
  const { translateLanguages } = useTranslate()
  // const assistantModel = assistant?.model
  const {
    deleteMessage,
    resendMessage,
    regenerateAssistantMessage,
    getTranslationUpdater,
    appendAssistantResponse,
    removeMessageBlock
  } = useMessageOperations(topic)

  const { isBubbleStyle } = useMessageStyle()
  const { enableDeveloperMode } = useEnableDeveloperMode()
  const { confirmDeleteMessage, confirmRegenerateMessage } = useSettings()

  // const loading = useTopicLoading(topic)

  const isUserMessage = message.role === 'user'

  const exportMenuOptions = useSelector((state: RootState) => state.settings.exportMenuOptions)
  const dispatch = useAppDispatch()

  // const processedMessage = useMemo(() => {
  //   if (message.role === 'assistant' && message.model && isReasoningModel(message.model)) {
  //     return withMessageThought(message)
  //   }
  //   return message
  // }, [message])

  const mainTextContent = useMemo(() => {
    // 只处理助手消息和来自推理模型的消息
    // if (message.role === 'assistant' && message.model && isReasoningModel(message.model)) {
    // return getMainTextContent(withMessageThought(message))
    // }
    return getMainTextContent(message)
  }, [message])

  const onCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()

      const currentMessageId = message.id // from props
      const latestMessageEntity = store.getState().messages.entities[currentMessageId]

      let contentToCopy = ''
      if (latestMessageEntity) {
        contentToCopy = getMainTextContent(latestMessageEntity as Message)
      } else {
        contentToCopy = getMainTextContent(message)
      }

      navigator.clipboard.writeText(removeTrailingDoubleSpaces(contentToCopy.trimStart()))

      window.toast.success(t('message.copied'))
      setCopied(true)
    },
    [message, setCopied, t] // message is needed for message.id and as a fallback. t is for translation.
  )

  const onNewBranch = useCallback(async () => {
    EventEmitter.emit(EVENT_NAMES.NEW_BRANCH, index)
    window.toast.success(t('chat.message.new.branch.created'))
  }, [index, t])

  const handleResendUserMessage = useCallback(
    async (messageUpdate?: Message) => {
      await resendMessage(messageUpdate ?? message, assistant)
    },
    [assistant, message, resendMessage]
  )

  const { startEditing } = useMessageEditing()

  const onEdit = useCallback(async () => {
    startEditing(message.id)
  }, [message.id, startEditing])

  const handleTranslate = useCallback(
    async (language: TranslateLanguage) => {
      if (isTranslating) return

      setIsTranslating(true)
      const messageId = message.id
      const translationUpdater = await getTranslationUpdater(messageId, language.langCode)
      if (!translationUpdater) return
      try {
        await translateText(mainTextContent, language, translationUpdater)
      } catch (error) {
        window.toast.error(t('translate.error.failed'))
        // 理应只有一个
        const translationBlocks = findTranslationBlocksById(message.id)
        logger.silly(`there are ${translationBlocks.length} translation blocks`)
        if (translationBlocks.length > 0) {
          const block = translationBlocks[0]
          logger.silly(`block`, block)
          if (!block.content) {
            dispatch(removeOneBlock(block.id))
          }
        }

        // clearStreamMessage(message.id)
      } finally {
        setIsTranslating(false)
      }
    },
    [isTranslating, message, getTranslationUpdater, mainTextContent, t, dispatch]
  )

  const handleTraceUserMessage = useCallback(async () => {
    if (message.traceId) {
      window.api.trace.openWindow(
        message.topicId,
        message.traceId,
        true,
        message.role === 'user' ? undefined : message.model?.name
      )
    }
  }, [message])

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
              onClick: onEdit
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
        children: [
          exportMenuOptions.plain_text && {
            label: t('chat.topics.copy.plain_text'),
            key: 'copy_message_plain_text',
            onClick: () => copyMessageAsPlainText(message)
          },
          exportMenuOptions.image && {
            label: t('chat.topics.copy.image'),
            key: 'img',
            onClick: async () => {
              await captureScrollableAsBlob(messageContainerRef, async (blob) => {
                if (blob) {
                  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
                }
              })
            }
          },
          exportMenuOptions.image && {
            label: t('chat.topics.export.image'),
            key: 'image',
            onClick: async () => {
              const imageData = await captureScrollableAsDataURL(messageContainerRef)
              const title = await getMessageTitle(message)
              if (title && imageData) {
                window.api.file.saveImage(title, imageData)
              }
            }
          },
          exportMenuOptions.markdown && {
            label: t('chat.topics.export.md.label'),
            key: 'markdown',
            onClick: () => exportMessageAsMarkdown(message)
          },
          exportMenuOptions.markdown_reason && {
            label: t('chat.topics.export.md.reason'),
            key: 'markdown_reason',
            onClick: () => exportMessageAsMarkdown(message, true)
          },
          exportMenuOptions.docx && {
            label: t('chat.topics.export.word'),
            key: 'word',
            onClick: async () => {
              const markdown = messageToMarkdown(message)
              const title = await getMessageTitle(message)
              window.api.export.toWord(markdown, title)
            }
          },
          exportMenuOptions.notion && {
            label: t('chat.topics.export.notion'),
            key: 'notion',
            onClick: async () => {
              const title = await getMessageTitle(message)
              const markdown = messageToMarkdown(message)
              exportMessageToNotion(title, markdown, message)
            }
          },
          exportMenuOptions.yuque && {
            label: t('chat.topics.export.yuque'),
            key: 'yuque',
            onClick: async () => {
              const title = await getMessageTitle(message)
              const markdown = messageToMarkdown(message)
              exportMarkdownToYuque(title, markdown)
            }
          },
          exportMenuOptions.obsidian && {
            label: t('chat.topics.export.obsidian'),
            key: 'obsidian',
            onClick: async () => {
              const title = topic.name?.replace(/\//g, '_') || 'Untitled'
              await ObsidianExportPopup.show({ title, message, processingMethod: '1' })
            }
          },
          exportMenuOptions.joplin && {
            label: t('chat.topics.export.joplin'),
            key: 'joplin',
            onClick: async () => {
              const title = await getMessageTitle(message)
              exportMarkdownToJoplin(title, message)
            }
          },
          exportMenuOptions.siyuan && {
            label: t('chat.topics.export.siyuan'),
            key: 'siyuan',
            onClick: async () => {
              const title = await getMessageTitle(message)
              const markdown = messageToMarkdown(message)
              exportMarkdownToSiyuan(title, markdown)
            }
          }
        ].filter(Boolean)
      }
    ],
    [
      isEditable,
      t,
      onEdit,
      onNewBranch,
      exportMenuOptions.plain_text,
      exportMenuOptions.image,
      exportMenuOptions.markdown,
      exportMenuOptions.markdown_reason,
      exportMenuOptions.docx,
      exportMenuOptions.notion,
      exportMenuOptions.yuque,
      exportMenuOptions.obsidian,
      exportMenuOptions.joplin,
      exportMenuOptions.siyuan,
      toggleMultiSelectMode,
      message,
      mainTextContent,
      messageContainerRef,
      topic.name
    ]
  )

  const onRegenerate = async (e: React.MouseEvent | undefined) => {
    e?.stopPropagation?.()
    // No need to reset or edit the message anymore
    // const selectedModel = isGrouped ? model : assistantModel
    // const _message = resetAssistantMessage(message, selectedModel)
    // editMessage(message.id, { ..._message }) // REMOVED

    // Call the function from the hook
    regenerateAssistantMessage(message, assistant)
  }

  // 按条件筛选能够提及的模型，该函数仅在isAssistantMessage时会用到
  const mentionModelFilter = useMemo(() => {
    const defaultFilter = (model: Model) => !isEmbeddingModel(model) && !isRerankModel(model)

    if (!isAssistantMessage) {
      return defaultFilter
    }
    const state = store.getState()
    const topicMessages: Message[] = selectMessagesForTopic(state, topic.id)
    // 理论上助手消息只会关联一条用户消息
    const relatedUserMessage = topicMessages.find((msg) => {
      return msg.role === 'user' && message.askId === msg.id
    })
    // 无关联用户消息时，默认返回所有模型
    if (!relatedUserMessage) {
      return defaultFilter
    }

    const relatedUserMessageBlocks = relatedUserMessage.blocks.map((msgBlockId) =>
      messageBlocksSelectors.selectById(store.getState(), msgBlockId)
    )

    if (!relatedUserMessageBlocks) {
      return defaultFilter
    }

    if (relatedUserMessageBlocks.some((block) => block && block.type === MessageBlockType.IMAGE)) {
      return (m: Model) => isVisionModel(m) && defaultFilter(m)
    } else {
      return defaultFilter
    }
  }, [isAssistantMessage, message.askId, topic.id])

  const onMentionModel = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      const selectedModel = await SelectModelPopup.show({ model, filter: mentionModelFilter })
      if (!selectedModel) return
      appendAssistantResponse(message, selectedModel, { ...assistant, model: selectedModel })
    },
    [appendAssistantResponse, assistant, mentionModelFilter, message, model]
  )

  const onUseful = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onUpdateUseful?.(message.id)
    },
    [message.id, onUpdateUseful]
  )

  const blockEntities = useSelector(messageBlocksSelectors.selectEntities)
  const hasTranslationBlocks = useMemo(() => {
    const translationBlocks = findTranslationBlocks(message)
    return translationBlocks.length > 0
  }, [message])

  const softHoverBg = isBubbleStyle && !isLastMessage
  const showMessageTokens = !isBubbleStyle
  const isUserBubbleStyleMessage = isBubbleStyle && isUserMessage

  return (
    <>
      {showMessageTokens && <MessageTokens message={message} />}
      <MenusBar
        className={classNames({ menubar: true, show: isLastMessage, 'user-bubble-style': isUserBubbleStyleMessage })}>
        {message.role === 'user' &&
          (confirmRegenerateMessage ? (
            <Popconfirm
              title={t('message.regenerate.confirm')}
              okButtonProps={{ danger: true }}
              onConfirm={() => handleResendUserMessage()}
              onOpenChange={(open) => open && setShowDeleteTooltip(false)}>
              <Tooltip title={t('common.regenerate')} mouseEnterDelay={0.8}>
                <ActionButton
                  className="message-action-button"
                  onClick={(e) => e.stopPropagation()}
                  $softHoverBg={isBubbleStyle}>
                  <RefreshIcon size={15} />
                </ActionButton>
              </Tooltip>
            </Popconfirm>
          ) : (
            <Tooltip title={t('common.regenerate')} mouseEnterDelay={0.8}>
              <ActionButton
                className="message-action-button"
                onClick={() => handleResendUserMessage()}
                $softHoverBg={isBubbleStyle}>
                <RefreshIcon size={15} />
              </ActionButton>
            </Tooltip>
          ))}
        {message.role === 'user' && (
          <Tooltip title={t('common.edit')} mouseEnterDelay={0.8}>
            <ActionButton className="message-action-button" onClick={onEdit} $softHoverBg={softHoverBg}>
              <EditIcon size={15} />
            </ActionButton>
          </Tooltip>
        )}
        <Tooltip title={t('common.copy')} mouseEnterDelay={0.8}>
          <ActionButton className="message-action-button" onClick={onCopy} $softHoverBg={softHoverBg}>
            {!copied && <CopyIcon size={15} />}
            {copied && <Check size={15} color="var(--color-primary)" />}
          </ActionButton>
        </Tooltip>
        {isAssistantMessage &&
          (confirmRegenerateMessage ? (
            <Popconfirm
              title={t('message.regenerate.confirm')}
              okButtonProps={{ danger: true }}
              onConfirm={onRegenerate}
              onOpenChange={(open) => open && setShowDeleteTooltip(false)}>
              <Tooltip title={t('common.regenerate')} mouseEnterDelay={0.8}>
                <ActionButton
                  className="message-action-button"
                  onClick={(e) => e.stopPropagation()}
                  $softHoverBg={softHoverBg}>
                  <RefreshIcon size={15} />
                </ActionButton>
              </Tooltip>
            </Popconfirm>
          ) : (
            <Tooltip title={t('common.regenerate')} mouseEnterDelay={0.8}>
              <ActionButton className="message-action-button" onClick={onRegenerate} $softHoverBg={softHoverBg}>
                <RefreshIcon size={15} />
              </ActionButton>
            </Tooltip>
          ))}
        {isAssistantMessage && (
          <Tooltip title={t('message.mention.title')} mouseEnterDelay={0.8}>
            <ActionButton className="message-action-button" onClick={onMentionModel} $softHoverBg={softHoverBg}>
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
                              window.toast.success(t('translate.copied'))
                            } else {
                              window.toast.warning(t('translate.empty'))
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
                            window.toast.success(t('translate.closed'))
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
        {isAssistantMessage && (
          <Tooltip title={t('notes.save')} mouseEnterDelay={0.8}>
            <ActionButton
              className="message-action-button"
              onClick={async (e) => {
                e.stopPropagation()
                const title = await getMessageTitle(message)
                const markdown = messageToMarkdown(message)
                exportMessageToNotes(title, markdown, notesPath)
              }}
              $softHoverBg={softHoverBg}>
              <NotebookPen size={15} />
            </ActionButton>
          </Tooltip>
        )}
        {confirmDeleteMessage ? (
          <Popconfirm
            title={t('message.message.delete.content')}
            okButtonProps={{ danger: true }}
            onConfirm={() => deleteMessage(message.id, message.traceId, message.model?.name)}
            onOpenChange={(open) => open && setShowDeleteTooltip(false)}>
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
        ) : (
          <ActionButton
            className="message-action-button"
            onClick={(e) => {
              e.stopPropagation()
              deleteMessage(message.id, message.traceId, message.model?.name)
            }}
            $softHoverBg={softHoverBg}>
            <Tooltip
              title={t('common.delete')}
              mouseEnterDelay={1}
              open={showDeleteTooltip}
              onOpenChange={setShowDeleteTooltip}>
              <DeleteIcon size={15} />
            </Tooltip>
          </ActionButton>
        )}
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
