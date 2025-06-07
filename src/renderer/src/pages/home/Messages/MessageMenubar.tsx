import { CheckOutlined, EditOutlined, MenuOutlined, QuestionCircleOutlined, SyncOutlined } from '@ant-design/icons'
import ObsidianExportPopup from '@renderer/components/Popups/ObsidianExportPopup'
import SelectModelPopup from '@renderer/components/Popups/SelectModelPopup'
import { TranslateLanguageOptions } from '@renderer/config/translate'
import { useMessageEditing } from '@renderer/context/MessageEditingContext'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useMessageOperations, useTopicLoading } from '@renderer/hooks/useMessageOperations'
import { useTTS } from '@renderer/hooks/useTTS'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getMessageTitle } from '@renderer/services/MessagesService'
import { translateText } from '@renderer/services/TranslateService'
import store, { RootState } from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import type { Model } from '@renderer/types'
import type { Assistant, Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { captureScrollableDivAsBlob, captureScrollableDivAsDataURL } from '@renderer/utils'
import {
  exportMarkdownToJoplin,
  exportMarkdownToSiyuan,
  exportMarkdownToYuque,
  exportMessageAsMarkdown,
  exportMessageToNotion,
  messageToMarkdown
} from '@renderer/utils/export'
// import { withMessageThought } from '@renderer/utils/formats'
import { markdownToTTSText, removeTrailingDoubleSpaces } from '@renderer/utils/markdown'
import { findMainTextBlocks, findTranslationBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { Dropdown, Popconfirm, Tooltip } from 'antd'
import dayjs from 'dayjs'
import {
  AtSign,
  Copy,
  Languages,
  Menu,
  Pause,
  Play,
  RefreshCw,
  Save,
  Share,
  Split,
  Square,
  ThumbsUp,
  Trash,
  Volume2
} from 'lucide-react'
import { FilePenLine } from 'lucide-react'
import { FC, memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

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
}

const MessageMenubar: FC<Props> = (props) => {
  const { message, index, isGrouped, isLastMessage, isAssistantMessage, assistant, topic, model, messageContainerRef } =
    props
  const { t } = useTranslation()
  const { toggleMultiSelectMode } = useChatContext(props.topic)
  const [copied, setCopied] = useState(false)
  const [isTranslating, setIsTranslating] = useState(false)
  const [showRegenerateTooltip, setShowRegenerateTooltip] = useState(false)
  const [showDeleteTooltip, setShowDeleteTooltip] = useState(false)

  // TTS 相关状态
  const tts = useTTS()
  const [isCurrentMessagePlaying, setIsCurrentMessagePlaying] = useState(false)
  const [isCurrentMessagePaused, setIsCurrentMessagePaused] = useState(false)
  // const assistantModel = assistant?.model
  const {
    editMessage,
    deleteMessage,
    resendMessage,
    regenerateAssistantMessage,
    getTranslationUpdater,
    appendAssistantResponse,
    removeMessageBlock
  } = useMessageOperations(topic)
  const loading = useTopicLoading(topic)

  const isUserMessage = message.role === 'user'

  const exportMenuOptions = useSelector((state: RootState) => state.settings.exportMenuOptions)

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

      window.message.success({ content: t('message.copied'), key: 'copy-message' })
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    },
    [message, t] // message is needed for message.id and as a fallback. t is for translation.
  )

  const onNewBranch = useCallback(async () => {
    if (loading) return
    EventEmitter.emit(EVENT_NAMES.NEW_BRANCH, index)
    window.message.success({ content: t('chat.message.new.branch.created'), key: 'new-branch' })
  }, [index, t, loading])

  const handleResendUserMessage = useCallback(
    async (messageUpdate?: Message) => {
      if (!loading) {
        await resendMessage(messageUpdate ?? message, assistant)
      }
    },
    [assistant, loading, message, resendMessage]
  )

  const { startEditing } = useMessageEditing()

  const onEdit = useCallback(async () => {
    startEditing(message.id)
  }, [message.id, startEditing])

  const handleTranslate = useCallback(
    async (language: string) => {
      if (isTranslating) return

      setIsTranslating(true)
      const messageId = message.id
      const translationUpdater = await getTranslationUpdater(messageId, language)
      if (!translationUpdater) return
      try {
        await translateText(mainTextContent, language, translationUpdater)
      } catch (error) {
        // console.error('Translation failed:', error)
        // window.message.error({ content: t('translate.error.failed'), key: 'translate-message' })
        // editMessage(message.id, { translatedContent: undefined })
        // clearStreamMessage(message.id)
      } finally {
        setIsTranslating(false)
      }
    },
    [isTranslating, message, getTranslationUpdater, mainTextContent]
  )

  const isEditable = useMemo(() => {
    return findMainTextBlocks(message).length > 0 // 使用 MCP Server 后会有大于一段 MatinTextBlock
  }, [message])

  const dropdownItems = useMemo(
    () => [
      {
        label: t('chat.save'),
        key: 'save',
        icon: <Save size={16} />,
        onClick: () => {
          const fileName = dayjs(message.createdAt).format('YYYYMMDDHHmm') + '.md'
          window.api.file.save(fileName, mainTextContent)
        }
      },
      ...(isEditable
        ? [
            {
              label: t('common.edit'),
              key: 'edit',
              icon: <FilePenLine size={16} />,
              onClick: onEdit
            }
          ]
        : []),
      {
        label: t('chat.message.new.branch'),
        key: 'new-branch',
        icon: <Split size={16} />,
        onClick: onNewBranch
      },
      {
        label: t('chat.multiple.select'),
        key: 'multi-select',
        icon: <MenuOutlined size={16} />,
        onClick: () => {
          toggleMultiSelectMode(true)
        }
      },
      {
        label: t('chat.topics.export.title'),
        key: 'export',
        icon: <Share size={16} color="var(--color-icon)" style={{ marginTop: 3 }} />,
        children: [
          exportMenuOptions.image && {
            label: t('chat.topics.copy.image'),
            key: 'img',
            onClick: async () => {
              await captureScrollableDivAsBlob(messageContainerRef, async (blob) => {
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
              const imageData = await captureScrollableDivAsDataURL(messageContainerRef)
              const title = await getMessageTitle(message)
              if (title && imageData) {
                window.api.file.saveImage(title, imageData)
              }
            }
          },
          exportMenuOptions.markdown && {
            label: t('chat.topics.export.md'),
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
      t,
      isEditable,
      onEdit,
      onNewBranch,
      exportMenuOptions,
      message,
      mainTextContent,
      toggleMultiSelectMode,
      messageContainerRef,
      topic.name
    ]
  )

  const onRegenerate = async (e: React.MouseEvent | undefined) => {
    e?.stopPropagation?.()
    if (loading) return
    // No need to reset or edit the message anymore
    // const selectedModel = isGrouped ? model : assistantModel
    // const _message = resetAssistantMessage(message, selectedModel)
    // editMessage(message.id, { ..._message }) // REMOVED

    // Call the function from the hook
    regenerateAssistantMessage(message, assistant)
  }

  const onMentionModel = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (loading) return
    const selectedModel = await SelectModelPopup.show({ model })
    if (!selectedModel) return
    appendAssistantResponse(message, selectedModel, { ...assistant, model: selectedModel })
  }

  const onUseful = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      editMessage(message.id, { useful: !message.useful })
    },
    [message, editMessage]
  )

  // TTS 播放处理
  const handleTTSPlay = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()

      if (!tts.isTTSAvailable) {
        window.message.warning({ content: t('settings.tts.not.available'), key: 'tts-not-available' })
        return
      }

      try {
        if (isCurrentMessagePlaying) {
          // 如果正在播放，则停止
          tts.stop()
          setIsCurrentMessagePlaying(false)
          setIsCurrentMessagePaused(false)
        } else if (isCurrentMessagePaused) {
          // 如果暂停，则恢复
          tts.resume()
          setIsCurrentMessagePlaying(true)
          setIsCurrentMessagePaused(false)
        } else {
          // 开始播放
          setIsCurrentMessagePlaying(true)
          setIsCurrentMessagePaused(false)

          // 停止其他正在播放的 TTS
          tts.stopAll()

          // 将 Markdown 转换为适合 TTS 播放的纯文本
          const ttsText = markdownToTTSText(mainTextContent)
          await tts.speak(ttsText)

          // 播放完成
          setIsCurrentMessagePlaying(false)
          setIsCurrentMessagePaused(false)
        }
      } catch (error) {
        // 检查是否是 MediaSource 相关的状态错误
        const isMediaSourceError =
          error instanceof Error &&
          error.name === 'InvalidStateError' &&
          (error.message.includes('endOfStream') ||
            error.message.includes('appendBuffer') ||
            error.message.includes('SourceBuffer'))

        if (isMediaSourceError) {
          // 这是一个 MediaSource 状态错误，通常是并发问题导致的
          console.warn('[MessageMenubar] TTS MediaSource state warning (may have played successfully):', error.message)
          setIsCurrentMessagePlaying(false)
          setIsCurrentMessagePaused(false)
          // 对于 MediaSource 状态错误，不显示错误消息，因为音频可能已经播放成功
        } else {
          // 真正的播放错误
          console.error('[MessageMenubar] TTS play failed:', error)
          setIsCurrentMessagePlaying(false)
          setIsCurrentMessagePaused(false)
          window.message.error({ content: t('settings.tts.play.failed'), key: 'tts-play-failed' })
        }
      }
    },
    [tts, isCurrentMessagePlaying, isCurrentMessagePaused, mainTextContent, t]
  )

  // TTS 暂停处理
  const handleTTSPause = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()

      if (isCurrentMessagePlaying) {
        tts.pause()
        setIsCurrentMessagePlaying(false)
        setIsCurrentMessagePaused(true)
      }
    },
    [tts, isCurrentMessagePlaying]
  )

  const blockEntities = useSelector(messageBlocksSelectors.selectEntities)
  const hasTranslationBlocks = useMemo(() => {
    const translationBlocks = findTranslationBlocks(message)
    return translationBlocks.length > 0
  }, [message])

  return (
    <MenusBar className={`menubar ${isLastMessage && 'show'}`}>
      {message.role === 'user' && (
        <Tooltip title={t('common.regenerate')} mouseEnterDelay={0.8}>
          <ActionButton className="message-action-button" onClick={() => handleResendUserMessage()}>
            <SyncOutlined />
          </ActionButton>
        </Tooltip>
      )}
      {message.role === 'user' && (
        <Tooltip title={t('common.edit')} mouseEnterDelay={0.8}>
          <ActionButton className="message-action-button" onClick={onEdit}>
            <EditOutlined />
          </ActionButton>
        </Tooltip>
      )}
      <Tooltip title={t('common.copy')} mouseEnterDelay={0.8}>
        <ActionButton className="message-action-button" onClick={onCopy}>
          {!copied && <Copy size={16} />}
          {copied && <CheckOutlined style={{ color: 'var(--color-primary)' }} />}
        </ActionButton>
      </Tooltip>
      {/* TTS 播放按钮（仅对助手消息显示） */}
      {isAssistantMessage && tts.isTTSAvailable && (
        <>
          <Tooltip
            title={
              isCurrentMessagePlaying
                ? t('settings.tts.stop')
                : isCurrentMessagePaused
                  ? t('settings.tts.resume')
                  : t('settings.tts.play')
            }
            mouseEnterDelay={0.8}>
            <ActionButton className="message-action-button" onClick={handleTTSPlay}>
              {isCurrentMessagePlaying ? (
                <Square size={16} />
              ) : isCurrentMessagePaused ? (
                <Play size={16} />
              ) : (
                <Volume2 size={16} />
              )}
            </ActionButton>
          </Tooltip>
          {isCurrentMessagePlaying && (
            <Tooltip title={t('settings.tts.pause')} mouseEnterDelay={0.8}>
              <ActionButton className="message-action-button" onClick={handleTTSPause}>
                <Pause size={16} />
              </ActionButton>
            </Tooltip>
          )}
        </>
      )}
      {isAssistantMessage && (
        <Popconfirm
          title={t('message.regenerate.confirm')}
          okButtonProps={{ danger: true }}
          icon={<QuestionCircleOutlined style={{ color: 'red' }} />}
          onConfirm={onRegenerate}
          onOpenChange={(open) => open && setShowRegenerateTooltip(false)}>
          <Tooltip
            title={t('common.regenerate')}
            mouseEnterDelay={0.8}
            open={showRegenerateTooltip}
            onOpenChange={setShowRegenerateTooltip}>
            <ActionButton className="message-action-button">
              <RefreshCw size={16} />
            </ActionButton>
          </Tooltip>
        </Popconfirm>
      )}
      {isAssistantMessage && (
        <Tooltip title={t('message.mention.title')} mouseEnterDelay={0.8}>
          <ActionButton className="message-action-button" onClick={onMentionModel}>
            <AtSign size={16} />
          </ActionButton>
        </Tooltip>
      )}
      {!isUserMessage && (
        <Dropdown
          menu={{
            items: [
              ...TranslateLanguageOptions.map((item) => ({
                label: item.emoji + ' ' + item.label,
                key: item.value,
                onClick: () => handleTranslate(item.value)
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
          placement="topRight"
          arrow>
          <Tooltip title={t('chat.translate')} mouseEnterDelay={1.2}>
            <ActionButton className="message-action-button" onClick={(e) => e.stopPropagation()}>
              <Languages size={16} />
            </ActionButton>
          </Tooltip>
        </Dropdown>
      )}
      {isAssistantMessage && isGrouped && (
        <Tooltip title={t('chat.message.useful')} mouseEnterDelay={0.8}>
          <ActionButton className="message-action-button" onClick={onUseful}>
            {message.useful ? (
              <ThumbsUp size={17.5} fill="var(--color-primary)" strokeWidth={0} />
            ) : (
              <ThumbsUp size={16} />
            )}
          </ActionButton>
        </Tooltip>
      )}
      <Popconfirm
        title={t('message.message.delete.content')}
        okButtonProps={{ danger: true }}
        icon={<QuestionCircleOutlined style={{ color: 'red' }} />}
        onOpenChange={(open) => open && setShowDeleteTooltip(false)}
        onConfirm={() => deleteMessage(message.id)}>
        <ActionButton className="message-action-button" onClick={(e) => e.stopPropagation()}>
          <Tooltip
            title={t('common.delete')}
            mouseEnterDelay={1}
            open={showDeleteTooltip}
            onOpenChange={setShowDeleteTooltip}>
            <Trash size={16} />
          </Tooltip>
        </ActionButton>
      </Popconfirm>
      {!isUserMessage && (
        <Dropdown
          menu={{ items: dropdownItems, onClick: (e) => e.domEvent.stopPropagation() }}
          trigger={['click']}
          placement="topRight"
          arrow>
          <ActionButton className="message-action-button" onClick={(e) => e.stopPropagation()}>
            <Menu size={19} />
          </ActionButton>
        </Dropdown>
      )}
    </MenusBar>
  )
}

const MenusBar = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
`

const ActionButton = styled.div`
  cursor: pointer;
  border-radius: 8px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  width: 30px;
  height: 30px;
  transition: all 0.2s ease;
  &:hover {
    background-color: var(--color-background-mute);
    .anticon {
      color: var(--color-text-1);
    }
  }
  .anticon,
  .iconfont {
    cursor: pointer;
    font-size: 14px;
    color: var(--color-icon);
  }
  &:hover {
    color: var(--color-text-1);
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
