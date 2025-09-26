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
import { MessageBlock, MessageBlockStatus } from '@renderer/types/newMessage'
import { classNames } from '@renderer/utils'
import { abortCompletion } from '@renderer/utils/abortController'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { getSendMessageShortcutLabel, isSendMessageKeyPressed } from '@renderer/utils/input'
import { createMainTextBlock, createMessage } from '@renderer/utils/messageUtils/create'
import TextArea, { TextAreaRef } from 'antd/es/input/TextArea'
import { isEmpty } from 'lodash'
import { CirclePause } from 'lucide-react'
import React, { CSSProperties, FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { v4 as uuid } from 'uuid'

import NarrowLayout from '../Messages/NarrowLayout'
import SendMessageButton from './SendMessageButton'

const logger = loggerService.withContext('AgentSessionInputbar')

type Props = {
  agentId: string
  sessionId: string
}

const AgentSessionInputbar: FC<Props> = ({ agentId, sessionId }) => {
  const [text, setText] = useState('')
  const [inputFocus, setInputFocus] = useState(false)
  const { session } = useSession(agentId, sessionId)
  const { agent } = useAgent(agentId)
  const { apiServer } = useSettings()

  const { sendMessageShortcut, fontSize, enableSpellCheck } = useSettings()
  const textareaRef = useRef<TextAreaRef>(null)
  const { t } = useTranslation()

  const containerRef = useRef<HTMLDivElement>(null)

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
    const isEnterPressed = event.key === 'Enter' && !event.nativeEvent.isComposing
    if (isEnterPressed) {
      if (isSendMessageKeyPressed(event, sendMessageShortcut)) {
        sendMessage()
        event.preventDefault()
        return
      }

      if (event.shiftKey) {
        return
      }

      event.preventDefault()
      const textArea = textareaRef.current?.resizableTextArea?.textArea
      if (textArea) {
        const start = textArea.selectionStart
        const end = textArea.selectionEnd
        const currentText = textArea.value
        const newText = currentText.substring(0, start) + '\n' + currentText.substring(end)

        setText(newText)

        setTimeoutTimer(
          'agentSession_handleKeyDown',
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
      setTimeoutTimer('agentSession_sendMessage', () => setText(''), 500)
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
    setText(e.target.value)
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
                  <ActionIconButton onClick={abortAgentSession} style={{ marginRight: -2 }}>
                    <CirclePause size={20} color="var(--color-error)" />
                  </ActionIconButton>
                </Tooltip>
              )}
            </div>
          </div>
        </InputBarContainer>
      </Container>
    </NarrowLayout>
  )
}

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
  padding-top: 8px;
  background-color: var(--color-background-opacity);
`

const TextareaStyle: CSSProperties = {
  paddingLeft: 0,
  padding: '6px 15px 0px'
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
