import {
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  ForkOutlined,
  MenuOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
  SyncOutlined,
  TranslationOutlined
} from '@ant-design/icons'
import SelectModelPopup from '@renderer/components/Popups/SelectModelPopup'
import TextEditPopup from '@renderer/components/Popups/TextEditPopup'
import { modelGenerating } from '@renderer/hooks/useRuntime'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { translateText } from '@renderer/services/TranslateService'
import { Message, Model } from '@renderer/types'
import { removeTrailingDoubleSpaces, uuid } from '@renderer/utils'
import { Button, Dropdown, Popconfirm, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { FC, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  message: Message
  assistantModel?: Model
  model?: Model
  index?: number
  isLastMessage: boolean
  isAssistantMessage: boolean
  setModel: (model: Model) => void
  onEditMessage?: (message: Message) => void
  onDeleteMessage?: (message: Message) => void
  onGetMessages?: () => Message[]
}

const MessageMenubar: FC<Props> = (props) => {
  const {
    message,
    index,
    model,
    isLastMessage,
    isAssistantMessage,
    assistantModel,
    setModel,
    onEditMessage,
    onDeleteMessage,
    onGetMessages
  } = props
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [isTranslating, setIsTranslating] = useState(false)

  const isUserMessage = message.role === 'user'
  const canRegenerate = isLastMessage && isAssistantMessage

  const onCopy = useCallback(() => {
    navigator.clipboard.writeText(removeTrailingDoubleSpaces(message.content))
    window.message.success({ content: t('message.copied'), key: 'copy-message' })
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [message.content, t])

  const onRegenerate = useCallback(
    (model: Model) => {
      setModel(model)
      setTimeout(() => EventEmitter.emit(EVENT_NAMES.REGENERATE_MESSAGE, model), 100)
    },
    [setModel]
  )

  const onNewBranch = useCallback(async () => {
    await modelGenerating()
    EventEmitter.emit(EVENT_NAMES.NEW_BRANCH, index)
    window.message.success({
      content: t('chat.message.new.branch.created'),
      key: 'new-branch'
    })
  }, [index, t])

  const onResend = useCallback(async () => {
    await modelGenerating()
    const _messages = onGetMessages?.() || []
    const index = _messages.findIndex((m) => m.id === message.id)
    const nextIndex = index + 1
    const nextMessage = _messages[nextIndex]

    if (nextMessage && nextMessage.role === 'assistant') {
      EventEmitter.emit(EVENT_NAMES.RESEND_MESSAGE + ':' + nextMessage.id, {
        ...nextMessage,
        content: '',
        status: 'sending',
        modelId: assistantModel?.id || model?.id,
        translatedContent: undefined
      })
    }

    if (!nextMessage) {
      onDeleteMessage?.(message)
      EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE, { ...message, id: uuid() })
    }
  }, [assistantModel?.id, message, model?.id, onDeleteMessage, onGetMessages])

  const onEdit = useCallback(async () => {
    let resendMessage = false

    const editedText = await TextEditPopup.show({
      text: message.content,
      children: (props) => (
        <ReSendButton
          icon={<i className="iconfont icon-ic_send" style={{ color: 'var(--color-primary)' }} />}
          onClick={() => {
            props.onOk?.()
            resendMessage = true
          }}>
          {t('chat.resend')}
        </ReSendButton>
      )
    })

    editedText && onEditMessage?.({ ...message, content: editedText })
    resendMessage && onResend()
  }, [message, onEditMessage, onResend, t])

  const handleTranslate = useCallback(
    async (language: string) => {
      if (isTranslating) return

      onEditMessage?.({ ...message, translatedContent: t('translate.processing') })

      setIsTranslating(true)

      try {
        const translatedText = await translateText(message.content, language)
        onEditMessage?.({ ...message, translatedContent: translatedText })
      } catch (error) {
        console.error('Translation failed:', error)
        window.message.error({
          content: t('translate.error.failed'),
          key: 'translate-message'
        })
        onEditMessage?.({ ...message, translatedContent: undefined })
      } finally {
        setIsTranslating(false)
      }
    },
    [isTranslating, message, onEditMessage, t]
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
      {
        label: t('common.edit'),
        key: 'edit',
        icon: <EditOutlined />,
        onClick: onEdit
      },
      {
        label: t('chat.message.new.branch'),
        key: 'new-branch',
        icon: <ForkOutlined />,
        onClick: onNewBranch
      }
    ],
    [message, onEdit, onNewBranch, t]
  )

  const onAtModelRegenerate = async () => {
    await modelGenerating()
    const selectedModel = await SelectModelPopup.show({ model })
    selectedModel && onRegenerate(selectedModel)
  }

  const onDeleteAndRegenerate = async () => {
    await modelGenerating()
    onEditMessage?.({
      ...message,
      content: '',
      status: 'sending',
      modelId: assistantModel?.id || model?.id,
      translatedContent: undefined
    })
  }

  return (
    <MenusBar className={`menubar ${isLastMessage && 'show'}`}>
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
          onConfirm={onDeleteAndRegenerate}>
          <Tooltip title={t('common.regenerate')} mouseEnterDelay={0.8}>
            <ActionButton className="message-action-button">
              <SyncOutlined />
            </ActionButton>
          </Tooltip>
        </Popconfirm>
      )}
      {canRegenerate && (
        <Tooltip title={t('chat.message.regenerate.model')} mouseEnterDelay={0.8}>
          <ActionButton className="message-action-button" onClick={onAtModelRegenerate}>
            <i className="iconfont icon-at"></i>
          </ActionButton>
        </Tooltip>
      )}
      {!isUserMessage && (
        <Dropdown
          menu={{
            items: [
              {
                label: '🇨🇳 ' + t('languages.chinese'),
                key: 'translate-chinese',
                onClick: () => handleTranslate('chinese')
              },
              {
                label: '🇭🇰 ' + t('languages.chinese-traditional'),
                key: 'translate-chinese-traditional',
                onClick: () => handleTranslate('chinese-traditional')
              },
              {
                label: '🇬🇧 ' + t('languages.english'),
                key: 'translate-english',
                onClick: () => handleTranslate('english')
              },
              {
                label: '🇯🇵 ' + t('languages.japanese'),
                key: 'translate-japanese',
                onClick: () => handleTranslate('japanese')
              },
              {
                label: '🇰🇷 ' + t('languages.korean'),
                key: 'translate-korean',
                onClick: () => handleTranslate('korean')
              },
              {
                label: '🇷🇺 ' + t('languages.russian'),
                key: 'translate-russian',
                onClick: () => handleTranslate('russian')
              },
              {
                label: '✖ ' + t('translate.close'),
                key: 'translate-close',
                onClick: () => onEditMessage?.({ ...message, translatedContent: undefined })
              }
            ]
          }}
          trigger={['click']}
          placement="topRight"
          arrow>
          <Tooltip title={t('chat.translate')} mouseEnterDelay={1.2}>
            <ActionButton className="message-action-button">
              <TranslationOutlined />
            </ActionButton>
          </Tooltip>
        </Dropdown>
      )}
      <Popconfirm
        title={t('message.message.delete.content')}
        okButtonProps={{ danger: true }}
        icon={<QuestionCircleOutlined style={{ color: 'red' }} />}
        onConfirm={() => onDeleteMessage?.(message)}>
        <Tooltip title={t('common.delete')} mouseEnterDelay={1}>
          <ActionButton className="message-action-button">
            <DeleteOutlined />
          </ActionButton>
        </Tooltip>
      </Popconfirm>
      {!isUserMessage && (
        <Dropdown menu={{ items: dropdownItems }} trigger={['click']} placement="topRight" arrow>
          <ActionButton className="message-action-button">
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
  margin-left: -5px;
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

export default MessageMenubar
