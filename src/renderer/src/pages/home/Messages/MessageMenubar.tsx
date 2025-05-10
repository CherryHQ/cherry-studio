import { CheckOutlined, EditOutlined, QuestionCircleOutlined, SyncOutlined } from '@ant-design/icons'
import ObsidianExportPopup from '@renderer/components/Popups/ObsidianExportPopup'
import SelectModelPopup from '@renderer/components/Popups/SelectModelPopup'
import TextEditPopup from '@renderer/components/Popups/TextEditPopup'
import { TranslateLanguageOptions } from '@renderer/config/translate'
import { useMessageOperations, useTopicLoading } from '@renderer/hooks/useMessageOperations'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getMessageTitle } from '@renderer/services/MessagesService'
import { translateText } from '@renderer/services/TranslateService'
import { RootState } from '@renderer/store'
import type { Model } from '@renderer/types'
import type { Assistant, Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { captureScrollableDivAsBlob, captureScrollableDivAsDataURL } from '@renderer/utils'
import {
  exportMarkdownToJoplin,
  exportMarkdownToNotion,
  exportMarkdownToSiyuan,
  exportMarkdownToYuque,
  exportMessageAsMarkdown,
  messageToMarkdown
} from '@renderer/utils/export'
// import { withMessageThought } from '@renderer/utils/formats'
import { removeTrailingDoubleSpaces } from '@renderer/utils/markdown'
import { findImageBlocks, findMainTextBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { Button, Dropdown, Popconfirm, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { AtSign, Copy, Languages, Menu, RefreshCw, Save, Share, Split, ThumbsUp, Trash } from 'lucide-react'
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
  const [copied, setCopied] = useState(false)
  const [isTranslating, setIsTranslating] = useState(false)
  const [showRegenerateTooltip, setShowRegenerateTooltip] = useState(false)
  const [showDeleteTooltip, setShowDeleteTooltip] = useState(false)
  // const assistantModel = assistant?.model
  const {
    editMessage,
    deleteMessage,
    resendMessage,
    regenerateAssistantMessage,
    resendUserMessageWithEdit,
    getTranslationUpdater,
    appendAssistantResponse,
    editMessageBlocks
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
      console.log('mainTextContent', mainTextContent)
      navigator.clipboard.writeText(removeTrailingDoubleSpaces(mainTextContent.trimStart()))

      window.message.success({ content: t('message.copied'), key: 'copy-message' })
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    },
    [mainTextContent, t]
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
    // 禁用了助手消息的编辑，现在都是用户消息的编辑
    let resendMessage = false

    let textToEdit = ''

    const imageBlocks = findImageBlocks(message)
    // 如果是包含图片的消息，添加图片的 markdown 格式
    if (imageBlocks.length > 0) {
      const imageMarkdown = imageBlocks
        .map((image, index) => `![image-${index}](file://${image?.file?.path})`)
        .join('\n')
      textToEdit = `${textToEdit}\n\n${imageMarkdown}`
    }
    textToEdit += mainTextContent
    // if (message.role === 'assistant' && message.model && isReasoningModel(message.model)) {
    //   //   const processedMessage = withMessageThought(clone(message))
    //   //   textToEdit = getMainTextContent(processedMessage)
    //   textToEdit = mainTextContent
    // }

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
      // 解析编辑后的文本，提取图片 URL
      // const imageRegex = /!\[image-\d+\]\((.*?)\)/g
      // const imageUrls: string[] = []
      // let match
      // let content = editedText
      // TODO 按理说图片应该走上传，不应该在这改
      // while ((match = imageRegex.exec(editedText)) !== null) {
      //   imageUrls.push(match[1])
      //   content = content.replace(match[0], '')
      // }
      if (resendMessage) {
        resendUserMessageWithEdit(message, editedText, assistant)
      } else {
        editMessageBlocks([{ ...findMainTextBlocks(message)[0], content: editedText }])
      }
      // // 更新消息内容，保留图片信息
      // await editMessage(message.id, {
      //   content: content.trim(),
      //   metadata: {
      //     ...message.metadata,
      //     generateImage:
      //       imageUrls.length > 0
      //         ? {
      //             type: 'url',
      //             images: imageUrls
      //           }
      //         : undefined
      //   }
      // })

      // resendMessage &&
      //   handleResendUserMessage({
      //     ...message,
      //     content: content.trim(),
      //     metadata: {
      //       ...message.metadata,
      //       generateImage:
      //         imageUrls.length > 0
      //           ? {
      //               type: 'url',
      //               images: imageUrls
      //             }
      //           : undefined
      //     }
      //   })
    }
  }, [resendUserMessageWithEdit, editMessageBlocks, assistant, mainTextContent, message, t])

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
      // {
      //   label: t('common.edit'),
      //   key: 'edit',
      //   icon: <FilePenLine size={16} />,
      //   onClick: onEdit
      // },
      {
        label: t('chat.message.new.branch'),
        key: 'new-branch',
        icon: <Split size={16} />,
        onClick: onNewBranch
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
              exportMarkdownToNotion(title, markdown)
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
              const markdown = messageToMarkdown(message)
              const title = topic.name?.replace(/\//g, '_') || 'Untitled'
              await ObsidianExportPopup.show({ title, markdown, processingMethod: '1' })
            }
          },
          exportMenuOptions.joplin && {
            label: t('chat.topics.export.joplin'),
            key: 'joplin',
            onClick: async () => {
              const title = await getMessageTitle(message)
              const markdown = messageToMarkdown(message)
              exportMarkdownToJoplin(title, markdown)
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
    [message, messageContainerRef, mainTextContent, onNewBranch, t, topic.name, exportMenuOptions]
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
              }))
              // {
              // TODO 删除翻译块可以放在翻译块内
              //   label: '✖ ' + t('translate.close'),
              //   key: 'translate-close',
              //   onClick: () => editMessage(message.id, { translatedContent: undefined })
              // }
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

const ReSendButton = styled(Button)`
  position: absolute;
  top: 10px;
  left: 0;
`

export default memo(MessageMenubar)
