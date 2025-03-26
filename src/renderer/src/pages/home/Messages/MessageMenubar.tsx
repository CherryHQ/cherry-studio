import {
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  ForkOutlined,
  LikeFilled,
  LikeOutlined,
  MenuOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
  SyncOutlined,
  TranslationOutlined
} from '@ant-design/icons'
import { UploadOutlined } from '@ant-design/icons'
import ObsidianExportPopup from '@renderer/components/Popups/ObsidianExportPopup'
import SelectModelPopup from '@renderer/components/Popups/SelectModelPopup'
import TextEditPopup from '@renderer/components/Popups/TextEditPopup'
import { isReasoningModel } from '@renderer/config/models'
import { TranslateLanguageOptions } from '@renderer/config/translate'
import { useMessageOperations } from '@renderer/hooks/useMessageOperations'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getMessageTitle, resetAssistantMessage } from '@renderer/services/MessagesService'
import { translateText } from '@renderer/services/TranslateService'
import { Message, Model } from '@renderer/types'
import { Assistant, Topic } from '@renderer/types'
import { captureScrollableDivAsBlob, captureScrollableDivAsDataURL, removeTrailingDoubleSpaces } from '@renderer/utils'
import {
  exportMarkdownToJoplin,
  exportMarkdownToNotion,
  exportMarkdownToSiyuan,
  exportMarkdownToYuque,
  exportMessageAsMarkdown,
  messageToMarkdown
} from '@renderer/utils/export'
import { withMessageThought } from '@renderer/utils/formats'
import { Button, Dropdown, Popconfirm, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { clone } from 'lodash'
import { FC, memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const [copied, setCopied] = useState(false)
  const [isTranslating, setIsTranslating] = useState(false)
  const [showRegenerateTooltip, setShowRegenerateTooltip] = useState(false)
  const [showDeleteTooltip, setShowDeleteTooltip] = useState(false)
  const assistantModel = assistant?.model
  const {
    loading,
    editMessage,
    setStreamMessage,
    deleteMessage,
    resendMessage,
    commitStreamMessage,
    clearStreamMessage
  } = useMessageOperations(topic)

  const isUserMessage = message.role === 'user'

  const onCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()

      // 只处理助手消息和来自推理模型的消息
      if (message.role === 'assistant' && message.model && isReasoningModel(message.model)) {
        const processedMessage = withMessageThought(clone(message))
        navigator.clipboard.writeText(removeTrailingDoubleSpaces(processedMessage.content.trimStart()))
      } else {
        // 其他情况直接复制原始内容
        navigator.clipboard.writeText(removeTrailingDoubleSpaces(message.content.trimStart()))
      }

      window.message.success({ content: t('message.copied'), key: 'copy-message' })
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    },
    [message, t]
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

  const onEdit = useCallback(async () => {
    let resendMessage = false

    let textToEdit = message.content

    if (message.role === 'assistant' && message.model && isReasoningModel(message.model)) {
      const processedMessage = withMessageThought(clone(message))
      textToEdit = processedMessage.content
    }

    const editedText = await TextEditPopup.show({
      text: textToEdit,
      children: (props) => {
        const onPress = () => {
          props.onOk?.()
          resendMessage = true
        }
        return message.role === 'user' ? (
          <ReSendButton
            icon={<i className="iconfont icon-ic_send" style={{ color: 'var(--color-primary)' }} />}
            onClick={onPress}>
            {t('chat.resend')}
          </ReSendButton>
        ) : null
      }
    })

    if (editedText && editedText !== textToEdit) {
      await editMessage(message.id, { content: editedText })
      resendMessage && handleResendUserMessage({ ...message, content: editedText })
    }
  }, [message, editMessage, handleResendUserMessage, t])

  const handleTranslate = useCallback(
    async (language: string) => {
      if (isTranslating) return

      editMessage(message.id, { translatedContent: t('translate.processing') })

      setIsTranslating(true)

      try {
        await translateText(message.content, language, (text) => {
          // 使用 setStreamMessage 来更新翻译内容
          setStreamMessage({ ...message, translatedContent: text })
        })

        // 翻译完成后，提交流消息
        commitStreamMessage(message.id)
      } catch (error) {
        console.error('Translation failed:', error)
        window.message.error({ content: t('translate.error.failed'), key: 'translate-message' })
        editMessage(message.id, { translatedContent: undefined })
        clearStreamMessage(message.id)
      } finally {
        setIsTranslating(false)
      }
    },
    [isTranslating, message, editMessage, setStreamMessage, commitStreamMessage, clearStreamMessage, t]
  )

  const dropdownItems = useMemo(
    () => [
      {
        label: t('chat.save'),
        key: 'save',
        icon: <SaveOutlined />,
        onClick: () => {
          const fileName = dayjs(message.createdAt).format('YYYYMMDDHHmm') + '.md'
          window.api.file.save(fileName, message.content)
        }
      },
      { label: t('common.edit'), key: 'edit', icon: <EditOutlined />, onClick: onEdit },
      { label: t('chat.message.new.branch'), key: 'new-branch', icon: <ForkOutlined />, onClick: onNewBranch },
      {
        label: t('chat.topics.export.title'),
        key: 'export',
        icon: <UploadOutlined />,
        children: [
          {
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
          {
            label: t('chat.topics.export.image'),
            key: 'image',
            onClick: async () => {
              const imageData = await captureScrollableDivAsDataURL(messageContainerRef)
              const title = getMessageTitle(message)
              if (title && imageData) {
                window.api.file.saveImage(title, imageData)
              }
            }
          },
          { label: t('chat.topics.export.md'), key: 'markdown', onClick: () => exportMessageAsMarkdown(message) },

          {
            label: t('chat.topics.export.word'),
            key: 'word',
            onClick: async () => {
              const markdown = messageToMarkdown(message)
              window.api.export.toWord(markdown, getMessageTitle(message))
            }
          },
          {
            label: t('chat.topics.export.notion'),
            key: 'notion',
            onClick: async () => {
              const title = getMessageTitle(message)
              const markdown = messageToMarkdown(message)
              exportMarkdownToNotion(title, markdown)
            }
          },
          {
            label: t('chat.topics.export.yuque'),
            key: 'yuque',
            onClick: async () => {
              const title = getMessageTitle(message)
              const markdown = messageToMarkdown(message)
              exportMarkdownToYuque(title, markdown)
            }
          },
          {
            label: t('chat.topics.export.obsidian'),
            key: 'obsidian',
            onClick: async () => {
              const markdown = messageToMarkdown(message)
              const title = topic.name?.replace(/\//g, '_') || 'Untitled'
              await ObsidianExportPopup.show({ title, markdown, processingMethod: '1' })
            }
          },
          {
            label: t('chat.topics.export.joplin'),
            key: 'joplin',
            onClick: async () => {
              const title = getMessageTitle(message)
              const markdown = messageToMarkdown(message)
              exportMarkdownToJoplin(title, markdown)
            }
          },
          {
            label: t('chat.topics.export.siyuan'),
            key: 'siyuan',
            onClick: async () => {
              const title = getMessageTitle(message)
              const markdown = messageToMarkdown(message)
              exportMarkdownToSiyuan(title, markdown)
            }
          }
        ]
      }
    ],
    [message, messageContainerRef, onEdit, onNewBranch, t, topic.name]
  )

  const onRegenerate = async (e: React.MouseEvent | undefined) => {
    e?.stopPropagation?.()
    if (loading) return
    const selectedModel = isGrouped ? model : assistantModel
    const _message = resetAssistantMessage(message, selectedModel)
    editMessage(message.id, { ..._message })
    resendMessage(_message, assistant)
  }

  const onMentionModel = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (loading) return
    const selectedModel = await SelectModelPopup.show({ model })
    if (!selectedModel) return
    resendMessage(message, { ...assistant, model: selectedModel }, true)
  }

  const onUseful = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      editMessage(message.id, { useful: !message.useful })
    },
    [message, editMessage]
  )

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
          {!copied && <i className="iconfont icon-copy"></i>}
          {copied && <CheckOutlined style={{ color: 'var(--color-primary)' }} />}
        </ActionButton>
      </Tooltip>
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
              <SyncOutlined />
            </ActionButton>
          </Tooltip>
        </Popconfirm>
      )}
      {isAssistantMessage && (
        <Tooltip title={t('message.mention.title')} mouseEnterDelay={0.8}>
          <ActionButton className="message-action-button" onClick={onMentionModel}>
            <i className="iconfont icon-at" style={{ fontSize: 16 }}></i>
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
              {
                label: '✖ ' + t('translate.close'),
                key: 'translate-close',
                onClick: () => editMessage(message.id, { translatedContent: undefined })
              }
            ],
            onClick: (e) => e.domEvent.stopPropagation()
          }}
          trigger={['click']}
          placement="topRight"
          arrow>
          <Tooltip title={t('chat.translate')} mouseEnterDelay={1.2}>
            <ActionButton className="message-action-button" onClick={(e) => e.stopPropagation()}>
              <TranslationOutlined />
            </ActionButton>
          </Tooltip>
        </Dropdown>
      )}
      {isAssistantMessage && isGrouped && (
        <Tooltip title={t('chat.message.useful')} mouseEnterDelay={0.8}>
          <ActionButton className="message-action-button" onClick={onUseful}>
            {message.useful ? <LikeFilled /> : <LikeOutlined />}
          </ActionButton>
        </Tooltip>
      )}
      <Popconfirm
        title={t('message.message.delete.content')}
        okButtonProps={{ danger: true }}
        icon={<QuestionCircleOutlined style={{ color: 'red' }} />}
        onOpenChange={(open) => open && setShowDeleteTooltip(false)}
        onConfirm={() => deleteMessage(message)}>
        <ActionButton className="message-action-button" onClick={(e) => e.stopPropagation()}>
          <Tooltip
            title={t('common.delete')}
            mouseEnterDelay={1}
            open={showDeleteTooltip}
            onOpenChange={setShowDeleteTooltip}>
            <DeleteOutlined />
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
            <MenuOutlined />
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

const ReSendButton = styled(Button)`
  position: absolute;
  top: 10px;
  left: 0;
`

export default memo(MessageMenubar)
