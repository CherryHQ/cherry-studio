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
import SelectModelPopup from '@renderer/components/Popups/SelectModelPopup'
import TextEditPopup from '@renderer/components/Popups/TextEditPopup'
import { TranslateLanguageOptions } from '@renderer/config/translate'
import { useMessageOperations } from '@renderer/hooks/useMessageOperations'
import { modelGenerating } from '@renderer/hooks/useRuntime'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getMessageTitle, resetAssistantMessage } from '@renderer/services/MessagesService'
import { translateText } from '@renderer/services/TranslateService'
import { Message, Model } from '@renderer/types'
import { Assistant, Topic } from '@renderer/types'
import { captureScrollableDivAsBlob, captureScrollableDivAsDataURL, removeTrailingDoubleSpaces } from '@renderer/utils'
import {
  exportMarkdownToNotion,
  exportMarkdownToYuque,
  exportMessageAsMarkdown,
  messageToMarkdown
} from '@renderer/utils/export'
import { Button, Dropdown, Popconfirm, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { isEmpty } from 'lodash'
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
  const assistantModel = assistant?.model
  const {
    messages,
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
      navigator.clipboard.writeText(removeTrailingDoubleSpaces(message.content))
      window.message.success({ content: t('message.copied'), key: 'copy-message' })
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    },
    [message.content, t]
  )

  const onNewBranch = useCallback(async () => {
    await modelGenerating()
    EventEmitter.emit(EVENT_NAMES.NEW_BRANCH, index)
    window.message.success({ content: t('chat.message.new.branch.created'), key: 'new-branch' })
  }, [index, t])

  const handleResendUserMessage = useCallback(
    async (messageUpdate?: Message) => {
      // messageUpdate 为了处理用户消息更改后的message
      await modelGenerating()
      const groupdMessages = messages.filter((m) => m.askId === message.id)

      // Resend all grouped messages
      if (!isEmpty(groupdMessages)) {
        for (const assistantMessage of groupdMessages) {
          const _model = assistantMessage.model || assistantModel
          await resendMessage({ ...assistantMessage, model: _model }, assistant)
        }
        return
      }

      await resendMessage(messageUpdate ?? message, assistant)
    },
    [message, assistantModel, resendMessage, assistant]
  )

  const onEdit = useCallback(async () => {
    let resendMessage = false

    const editedText = await TextEditPopup.show({
      text: message.content,
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
    if (editedText && editedText !== message.content) {
      // 同步修改store中用户消息
      editMessage(message.id, { content: editedText })

      // const updatedMessages = onGetMessages?.() || []
      // dispatch(updateMessages(topic, updatedMessages))
    }

    if (resendMessage) handleResendUserMessage({ ...message, content: editedText })
  }, [message, editMessage, topic, handleResendUserMessage, t])

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
          }
        ]
      }
    ],
    [message, messageContainerRef, onEdit, onNewBranch, t]
  )

  const onRegenerate = async (e: React.MouseEvent | undefined) => {
    e?.stopPropagation?.()
    await modelGenerating()
    const selectedModel = isGrouped ? model : assistantModel
    const _message = resetAssistantMessage(message, selectedModel)
    editMessage(message.id, { ..._message })
    resendMessage(_message, assistant)
  }

  const onMentionModel = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await modelGenerating()
    const selectedModel = await SelectModelPopup.show({ model })
    if (!selectedModel) return

    // const mentionModelMessage: Message = resetAssistantMessage(message, selectedModel)
    // dispatch(updateMessage({ topicId: topic.id, messageId: message.id, updates: _message }))
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
          destroyTooltipOnHide
          icon={<QuestionCircleOutlined style={{ color: 'red' }} />}
          onConfirm={onRegenerate}>
          <Tooltip title={t('common.regenerate')} mouseEnterDelay={0.8}>
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
      {!isGrouped && (
        <Popconfirm
          title={t('message.message.delete.content')}
          okButtonProps={{ danger: true }}
          icon={<QuestionCircleOutlined style={{ color: 'red' }} />}
          onConfirm={() => deleteMessage(message)}>
          <ActionButton className="message-action-button" onClick={(e) => e.stopPropagation()}>
            <Tooltip title={t('common.delete')} mouseEnterDelay={1}>
              <DeleteOutlined />
            </Tooltip>
          </ActionButton>
        </Popconfirm>
      )}
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
