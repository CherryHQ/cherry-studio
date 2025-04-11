import { FONT_FAMILY } from '@renderer/config/constant'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useModel } from '@renderer/hooks/useModel'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useMessageStyle, useSettings } from '@renderer/hooks/useSettings'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getMessageModelId } from '@renderer/services/MessagesService'
import { getModelUniqId } from '@renderer/services/ModelService'
import TTSService from '@renderer/services/TTSService'
import { RootState, useAppDispatch } from '@renderer/store'
import { setLastPlayedMessageId, setSkipNextAutoTTS } from '@renderer/store/settings'
import { Assistant, Message, Topic } from '@renderer/types'
import { classNames } from '@renderer/utils'
import { Divider, Dropdown } from 'antd'
import { Dispatch, FC, memo, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import MessageContent from './MessageContent'
import MessageErrorBoundary from './MessageErrorBoundary'
import MessageHeader from './MessageHeader'
import MessageMenubar from './MessageMenubar'
import MessageTokens from './MessageTokens'

interface Props {
  message: Message
  topic: Topic
  assistant?: Assistant
  index?: number
  total?: number
  hidePresetMessages?: boolean
  style?: React.CSSProperties
  isGrouped?: boolean
  isStreaming?: boolean
  onSetMessages?: Dispatch<SetStateAction<Message[]>>
}

const MessageItem: FC<Props> = ({
  message,
  topic,
  // assistant,
  index,
  hidePresetMessages,
  isGrouped,
  isStreaming = false,
  style
}) => {
  const { t } = useTranslation()
  const { assistant, setModel } = useAssistant(message.assistantId)
  const model = useModel(getMessageModelId(message), message.model?.provider) || message.model
  const { isBubbleStyle } = useMessageStyle()
  const { showMessageDivider, messageFont, fontSize } = useSettings()
  const { generating } = useRuntime()
  const messageContainerRef = useRef<HTMLDivElement>(null)
  // const topic = useTopic(assistant, _topic?.id)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [selectedQuoteText, setSelectedQuoteText] = useState<string>('')

  // 获取TTS设置
  const { ttsEnabled, isVoiceCallActive, lastPlayedMessageId, skipNextAutoTTS } = useSelector(
    (state: RootState) => state.settings
  )
  const dispatch = useAppDispatch()
  const [selectedText, setSelectedText] = useState<string>('')

  const isLastMessage = index === 0
  const isAssistantMessage = message.role === 'assistant'
  const showMenubar = !isStreaming && !message.status.includes('ing')

  const fontFamily = useMemo(() => {
    return messageFont === 'serif' ? FONT_FAMILY.replace('sans-serif', 'serif').replace('Ubuntu, ', '') : FONT_FAMILY
  }, [messageFont])

  const messageBorder = showMessageDivider ? undefined : 'none'
  const messageBackground = getMessageBackground(isBubbleStyle, isAssistantMessage)

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const _selectedText = window.getSelection()?.toString()
    if (_selectedText) {
      const quotedText =
        _selectedText
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n') + '\n-------------'
      setSelectedQuoteText(quotedText)
      setContextMenuPosition({ x: e.clientX, y: e.clientY })
      setSelectedText(_selectedText)
    }
  }, [])

  useEffect(() => {
    const handleClick = () => {
      setContextMenuPosition(null)
    }
    document.addEventListener('click', handleClick)
    return () => {
      document.removeEventListener('click', handleClick)
    }
  }, [])

  // 使用 ref 跟踪消息状态变化
  const prevGeneratingRef = useRef(generating)

  // 更新 prevGeneratingRef 的值
  useEffect(() => {
    // 在每次渲染后更新 ref 值
    prevGeneratingRef.current = generating
  }, [generating])

  // 监听新消息生成，并在新消息生成时重置 skipNextAutoTTS
  useEffect(() => {
    // 如果从生成中变为非生成中，说明新消息刚刚生成完成
    if (
      prevGeneratingRef.current &&
      !generating &&
      isLastMessage &&
      isAssistantMessage &&
      message.status === 'success'
    ) {
      console.log('新消息生成完成，消息ID:', message.id)

      // 当新消息生成完成时，始终重置 skipNextAutoTTS 为 false
      // 这样确保新生成的消息可以自动播放
      console.log('新消息生成完成，重置 skipNextAutoTTS 为 false')
      dispatch(setSkipNextAutoTTS(false))
    }
  }, [isLastMessage, isAssistantMessage, message.status, message.id, generating, dispatch, prevGeneratingRef])

  // 当消息内容变化时，重置 skipNextAutoTTS
  useEffect(() => {
    // 如果是最后一条助手消息，且消息状态为成功，且消息内容不为空
    if (
      isLastMessage &&
      isAssistantMessage &&
      message.status === 'success' &&
      message.content &&
      message.content.trim()
    ) {
      // 如果是新生成的消息，重置 skipNextAutoTTS 为 false
      if (message.id !== lastPlayedMessageId) {
        console.log(
          '检测到新消息，重置 skipNextAutoTTS 为 false，消息ID:',
          message.id,
          '消息内容前20个字符:',
          message.content?.substring(0, 20)
        )
        dispatch(setSkipNextAutoTTS(false))
      }
    }
  }, [isLastMessage, isAssistantMessage, message.status, message.content, message.id, lastPlayedMessageId, dispatch])

  // 自动播放TTS的逻辑
  useEffect(() => {
    // 如果是最后一条助手消息，且消息状态为成功，且不是正在生成中，且TTS已启用，且语音通话窗口已打开
    if (
      isLastMessage &&
      isAssistantMessage &&
      message.status === 'success' &&
      !generating &&
      ttsEnabled &&
      isVoiceCallActive
    ) {
      // 检查是否需要跳过自动TTS
      if (skipNextAutoTTS) {
        console.log(
          '跳过自动TTS，因为 skipNextAutoTTS 为 true，消息ID:',
          message.id,
          '消息内容前20个字符:',
          message.content?.substring(0, 20),
          '消息状态:',
          message.status,
          '是否最后一条消息:',
          isLastMessage,
          '是否助手消息:',
          isAssistantMessage,
          '是否正在生成中:',
          generating,
          '语音通话窗口状态:',
          isVoiceCallActive
        )
        // 注意：不在这里重置 skipNextAutoTTS，而是在新消息生成时重置
        return
      }

      console.log(
        '准备自动播放TTS，因为 skipNextAutoTTS 为 false，消息ID:',
        message.id,
        '消息内容前20个字符:',
        message.content?.substring(0, 20)
      )

      // 检查消息是否有内容，且消息是新的（不是上次播放过的消息）
      if (message.content && message.content.trim() && message.id !== lastPlayedMessageId) {
        console.log('自动播放最新助手消息的TTS:', message.id, '语音通话窗口状态:', isVoiceCallActive)

        // 更新最后播放的消息ID
        dispatch(setLastPlayedMessageId(message.id))

        // 使用延时确保消息已完全加载
        setTimeout(() => {
          TTSService.speakFromMessage(message)
        }, 500)
      } else if (message.id === lastPlayedMessageId) {
        console.log('不自动播放TTS，因为该消息已经播放过:', message.id)
      }
    } else if (
      isLastMessage &&
      isAssistantMessage &&
      message.status === 'success' &&
      !generating &&
      ttsEnabled &&
      !isVoiceCallActive
    ) {
      // 如果语音通话窗口没有打开，则不自动播放TTS
      console.log('不自动播放TTS，因为语音通话窗口没有打开')
    }
  }, [
    isLastMessage,
    isAssistantMessage,
    message,
    generating,
    ttsEnabled,
    isVoiceCallActive,
    lastPlayedMessageId,
    skipNextAutoTTS,
    dispatch
  ])

  const messageHighlightHandler = useCallback((highlight: boolean = true) => {
    if (messageContainerRef.current) {
      messageContainerRef.current.scrollIntoView({ behavior: 'smooth' })
      if (highlight) {
        setTimeout(() => {
          const classList = messageContainerRef.current?.classList
          classList?.add('message-highlight')
          setTimeout(() => classList?.remove('message-highlight'), 2500)
        }, 500)
      }
    }
  }, [])

  useEffect(() => {
    const unsubscribes = [EventEmitter.on(EVENT_NAMES.LOCATE_MESSAGE + ':' + message.id, messageHighlightHandler)]
    return () => unsubscribes.forEach((unsub) => unsub())
  }, [message.id, messageHighlightHandler])

  if (hidePresetMessages && message.isPreset) {
    return null
  }

  if (message.type === 'clear') {
    return (
      <NewContextMessage onClick={() => EventEmitter.emit(EVENT_NAMES.NEW_CONTEXT)}>
        <Divider dashed style={{ padding: '0 20px' }} plain>
          {t('chat.message.new.context')}
        </Divider>
      </NewContextMessage>
    )
  }

  return (
    <MessageContainer
      key={message.id}
      className={classNames({
        message: true,
        'message-assistant': isAssistantMessage,
        'message-user': !isAssistantMessage
      })}
      ref={messageContainerRef}
      onContextMenu={handleContextMenu}
      style={{ ...style, alignItems: isBubbleStyle ? (isAssistantMessage ? 'start' : 'end') : undefined }}>
      {contextMenuPosition && (
        <Dropdown
          overlayStyle={{ left: contextMenuPosition.x, top: contextMenuPosition.y, zIndex: 1000 }}
          menu={{ items: getContextMenuItems(t, selectedQuoteText, selectedText) }}
          open={true}
          trigger={['contextMenu']}>
          <div />
        </Dropdown>
      )}
      <MessageHeader message={message} assistant={assistant} model={model} key={getModelUniqId(model)} />
      <MessageContentContainer
        className="message-content-container"
        style={{ fontFamily, fontSize, background: messageBackground, overflowY: 'visible' }}>
        <MessageErrorBoundary>
          <MessageContent message={message} model={model} />
        </MessageErrorBoundary>
        {showMenubar && (
          <MessageFooter
            style={{
              border: messageBorder,
              flexDirection: isLastMessage || isBubbleStyle ? 'row-reverse' : undefined
            }}>
            <MessageTokens message={message} isLastMessage={isLastMessage} />
            <MessageMenubar
              message={message}
              assistant={assistant}
              model={model}
              index={index}
              topic={topic}
              isLastMessage={isLastMessage}
              isAssistantMessage={isAssistantMessage}
              isGrouped={isGrouped}
              messageContainerRef={messageContainerRef as React.RefObject<HTMLDivElement>}
              setModel={setModel}
            />
          </MessageFooter>
        )}
      </MessageContentContainer>
    </MessageContainer>
  )
}

const getMessageBackground = (isBubbleStyle: boolean, isAssistantMessage: boolean) => {
  return isBubbleStyle
    ? isAssistantMessage
      ? 'var(--chat-background-assistant)'
      : 'var(--chat-background-user)'
    : undefined
}

const getContextMenuItems = (t: (key: string) => string, selectedQuoteText: string, selectedText: string) => [
  {
    key: 'copy',
    label: t('common.copy'),
    onClick: () => {
      navigator.clipboard.writeText(selectedText)
      window.message.success({ content: t('message.copied'), key: 'copy-message' })
    }
  },
  {
    key: 'quote',
    label: t('chat.message.quote'),
    onClick: () => {
      EventEmitter.emit(EVENT_NAMES.QUOTE_TEXT, selectedQuoteText)
    }
  }
]

const MessageContainer = styled.div`
  display: flex;
  flex-direction: column;
  position: relative;
  transition: background-color 0.3s ease;
  padding: 0 20px;
  transform: translateZ(0);
  will-change: transform;
  &.message-highlight {
    background-color: var(--color-primary-mute);
  }
  .menubar {
    opacity: 0;
    transition: opacity 0.2s ease;
    transform: translateZ(0);
    will-change: opacity;
    &.show {
      opacity: 1;
    }
  }
  &:hover {
    .menubar {
      opacity: 1;
    }
  }
`

const MessageContentContainer = styled.div`
  max-width: 100%;
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: space-between;
  margin-left: 46px;
  margin-top: 5px;
  overflow-y: auto;
`

const MessageFooter = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 2px 0;
  margin-top: 2px;
  border-top: 1px dotted var(--color-border);
  gap: 20px;
`

const NewContextMessage = styled.div`
  cursor: pointer;
`

export default memo(MessageItem)
