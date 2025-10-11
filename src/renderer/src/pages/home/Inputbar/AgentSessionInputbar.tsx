import { Tooltip } from '@heroui/react'
import { loggerService } from '@logger'
import { ActionIconButton } from '@renderer/components/Buttons'
import { QuickPanelView } from '@renderer/components/QuickPanel'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useSession } from '@renderer/hooks/agents/useSession'
import { selectNewTopicLoading } from '@renderer/hooks/useMessageOperations'
import { getModel } from '@renderer/hooks/useModel'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTimer } from '@renderer/hooks/useTimer'
import PasteService from '@renderer/services/PasteService'
import { pauseTrace } from '@renderer/services/SpanManagerService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { newMessagesActions, selectMessagesForTopic } from '@renderer/store/newMessage'
import { sendMessage as dispatchSendMessage } from '@renderer/store/thunk/messageThunk'
import type { Assistant, Message, Model, Topic } from '@renderer/types'
import { type MessageBlock, MessageBlockStatus } from '@renderer/types/newMessage'
import { classNames } from '@renderer/utils'
import { abortCompletion } from '@renderer/utils/abortController'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { getSendMessageShortcutLabel, isSendMessageKeyPressed } from '@renderer/utils/input'
import { createMainTextBlock, createMessage } from '@renderer/utils/messageUtils/create'
import TextArea, { type TextAreaRef } from 'antd/es/input/TextArea'
import { isEmpty } from 'lodash'
import { CirclePause } from 'lucide-react'
import type { CSSProperties, FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { v4 as uuid } from 'uuid'

import NarrowLayout from '../Messages/NarrowLayout'
import SendMessageButton from './SendMessageButton'

const logger = loggerService.withContext('Inputbar')

type Props = {
  agentId: string
  sessionId: string
}

const _text = ''

const AgentSessionInputbar: FC<Props> = ({ agentId, sessionId }) => {
  const [text, setText] = useState(_text)
  const [inputFocus, setInputFocus] = useState(false)
  const { session } = useSession(agentId, sessionId)
  const { agent } = useAgent(agentId)
  const { apiServer } = useSettings()

  const { sendMessageShortcut, fontSize, enableSpellCheck } = useSettings()
  const textareaRef = useRef<TextAreaRef>(null)
  const { t } = useTranslation()

  const containerRef = useRef(null)

  const { setTimeoutTimer } = useTimer()
  const dispatch = useAppDispatch()
  const sessionTopicId = buildAgentSessionTopicId(sessionId)
  const topicMessages = useAppSelector((state) => selectMessagesForTopic(state, sessionTopicId))
  const loading = useAppSelector((state) => selectNewTopicLoading(state, sessionTopicId))

  const focusTextarea = useCallback(() => {
    textareaRef.current?.focus()
  }, [])

  const inputEmpty = isEmpty(text)
  const sendDisabled = inputEmpty || !apiServer.enabled

  const streamingAskIds = useMemo(() => {
    if (!topicMessages) {
      return []
    }

    const askIdSet = new Set<string>()
    for (const message of topicMessages) {
      if (!message) continue
      if (message.status === 'processing' || message.status === 'pending') {
        if (message.askId) {
          askIdSet.add(message.askId)
        } else if (message.id) {
          askIdSet.add(message.id)
        }
      }
    }

    return Array.from(askIdSet)
  }, [topicMessages])

  const canAbort = loading && streamingAskIds.length > 0

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    //to check if the SendMessage key is pressed
    //other keys should be ignored
    const isEnterPressed = event.key === 'Enter' && !event.nativeEvent.isComposing
    if (isEnterPressed) {
      // 1) 优先判断是否为“发送”（当前仅支持纯 Enter 发送；其余 Enter 组合键均换行）
      if (isSendMessageKeyPressed(event, sendMessageShortcut)) {
        sendMessage()
        return event.preventDefault()
      }

      // 2) 不再基于 quickPanel.isVisible 主动拦截。
      //    纯 Enter 的处理权交由 QuickPanel 的全局捕获（其只在纯 Enter 时拦截），
      //    其它带修饰键的 Enter 则由输入框处理为换行。

      if (event.shiftKey) {
        return
      }

      event.preventDefault()
      const textArea = textareaRef.current?.resizableTextArea?.textArea
      if (textArea) {
        const start = textArea.selectionStart
        const end = textArea.selectionEnd
        const text = textArea.value
        const newText = text.substring(0, start) + '\n' + text.substring(end)

        // update text by setState, not directly modify textarea.value
        setText(newText)

        // set cursor position in the next render cycle
        setTimeoutTimer(
          'handleKeyDown',
          () => {
            textArea.selectionStart = textArea.selectionEnd = start + 1
          },
          0
        )
      }
    }
  }

  const abortAgentSession = useCallback(async () => {
    if (!streamingAskIds.length) {
      logger.debug('No active agent session streams to abort', { sessionTopicId })
      return
    }

    logger.info('Aborting agent session message generation', {
      sessionTopicId,
      askIds: streamingAskIds
    })

    for (const askId of streamingAskIds) {
      abortCompletion(askId)
    }

    pauseTrace(sessionTopicId)
    dispatch(newMessagesActions.setTopicLoading({ topicId: sessionTopicId, loading: false }))
  }, [dispatch, sessionTopicId, streamingAskIds])

  const sendMessage = useCallback(async () => {
    if (sendDisabled) {
      return
    }

    logger.info('Starting to send message')

    try {
      const userMessageId = uuid()
      const mainBlock = createMainTextBlock(userMessageId, text, {
        status: MessageBlockStatus.SUCCESS
      })
      const userMessageBlocks: MessageBlock[] = [mainBlock]

      // Extract the actual model ID from session.model (format: "provider:modelId")
      const [providerId, actualModelId] = agent?.model.split(':') ?? [undefined, undefined]

      // Try to find the actual model from providers
      const actualModel = actualModelId ? getModel(actualModelId, providerId) : undefined

      const model: Model | undefined = actualModel
        ? {
            id: actualModel.id,
            name: actualModel.name, // Use actual model name if found
            provider: actualModel.provider,
            group: actualModel.group
          }
        : undefined

      const userMessage: Message = createMessage('user', sessionTopicId, agentId, {
        id: userMessageId,
        blocks: userMessageBlocks.map((block) => block?.id),
        model,
        modelId: model?.id
      })

      const assistantStub: Assistant = {
        id: session?.agent_id ?? agentId,
        name: session?.name ?? 'Agent Session',
        prompt: session?.instructions ?? '',
        topics: [] as Topic[],
        type: 'agent-session',
        model,
        defaultModel: model,
        tags: [],
        enableWebSearch: false
      }

      dispatch(
        dispatchSendMessage(userMessage, userMessageBlocks, assistantStub, sessionTopicId, {
          agentId,
          sessionId
        })
      )

      setText('')
      setTimeoutTimer('sendMessage_1', () => setText(''), 500)
    } catch (error) {
      logger.warn('Failed to send message:', error as Error)
    }
  }, [
    agent?.model,
    agentId,
    dispatch,
    sendDisabled,
    session?.agent_id,
    session?.instructions,
    session?.name,
    sessionId,
    sessionTopicId,
    setTimeoutTimer,
    text
  ])

  const onChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value
    setText(newText)
  }, [])

  useEffect(() => {
    if (!document.querySelector('.topview-fullscreen-container')) {
      focusTextarea()
    }
  }, [focusTextarea])

  useEffect(() => {
    const onFocus = () => {
      if (document.activeElement?.closest('.ant-modal')) {
        return
      }

      const lastFocusedComponent = PasteService.getLastFocusedComponent()

      if (!lastFocusedComponent || lastFocusedComponent === 'inputbar') {
        focusTextarea()
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [focusTextarea])

  return (
    <NarrowLayout style={{ width: '100%' }}>
      <Container className="inputbar">
        <QuickPanelView setInputText={setText} />
        <InputBarContainer
          id="inputbar"
          className={classNames('inputbar-container', inputFocus && 'focus')}
          ref={containerRef}>
          <Textarea
            value={text}
            onChange={onChange}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.input.placeholder', { key: getSendMessageShortcutLabel(sendMessageShortcut) })}
            autoFocus
            variant="borderless"
            spellCheck={enableSpellCheck}
            rows={2}
            autoSize={{ minRows: 2, maxRows: 20 }}
            ref={textareaRef}
            style={{
              fontSize,
              minHeight: '30px'
            }}
            styles={{ textarea: TextareaStyle }}
            onFocus={(e: React.FocusEvent<HTMLTextAreaElement>) => {
              setInputFocus(true)
              // 记录当前聚焦的组件
              PasteService.setLastFocusedComponent('inputbar')
              if (e.target.value.length === 0) {
                e.target.setSelectionRange(0, 0)
              }
            }}
            onBlur={() => setInputFocus(false)}
          />
          <div className="flex justify-end px-1">
            <div className="flex items-center gap-1">
              <SendMessageButton sendMessage={sendMessage} disabled={sendDisabled} />
              {canAbort && (
                <Tooltip placement="top" content={t('chat.input.pause')}>
                  <ActionIconButton
                    onClick={abortAgentSession}
                    className="-mr-0.5"
                    icon={<CirclePause size={20} color="var(--color-error)" />}
                  />
                </Tooltip>
              )}
            </div>
          </div>
        </InputBarContainer>
      </Container>
    </NarrowLayout>
  )
}

// Add these styled components at the bottom

const Container = styled.div`
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 2;
  padding: 0 18px 18px 18px;
  [navbar-position='top'] & {
    padding: 0 18px 10px 18px;
  }
`

const InputBarContainer = styled.div`
  border: 0.5px solid var(--color-border);
  transition: all 0.2s ease;
  position: relative;
  border-radius: 17px;
  padding-top: 8px; // 为拖动手柄留出空间
  background-color: var(--color-background-opacity);

  &.file-dragging {
    border: 2px dashed #2ecc71;

    &::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(46, 204, 113, 0.03);
      border-radius: 14px;
      z-index: 5;
      pointer-events: none;
    }
  }
`

const TextareaStyle: CSSProperties = {
  paddingLeft: 0,
  padding: '6px 15px 0px' // 减小顶部padding
}

const Textarea = styled(TextArea)`
  padding: 0;
  border-radius: 0;
  display: flex;
  resize: none !important;
  overflow: auto;
  width: 100%;
  box-sizing: border-box;
  transition: none !important;
  &.ant-input {
    line-height: 1.4;
  }
  &::-webkit-scrollbar {
    width: 3px;
  }
`

export default AgentSessionInputbar
