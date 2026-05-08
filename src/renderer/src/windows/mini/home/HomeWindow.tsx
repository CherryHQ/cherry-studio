import { loggerService } from '@logger'
import { isMac } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import { fetchChatCompletion } from '@renderer/services/ApiService'
import { getDefaultTopic } from '@renderer/services/AssistantService'
import { ConversationService } from '@renderer/services/ConversationService'
import { getAssistantMessage, getUserMessage } from '@renderer/services/MessagesService'
import store, { useAppSelector } from '@renderer/store'
import { updateOneBlock, upsertManyBlocks, upsertOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions, selectMessagesForTopic } from '@renderer/store/newMessage'
import { cancelThrottledBlockUpdate, throttledBlockUpdate } from '@renderer/store/thunk/messageThunk'
import type { Topic } from '@renderer/types'
import { ThemeMode } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import { AssistantMessageStatus, MessageBlockStatus } from '@renderer/types/newMessage'
import { abortCompletion } from '@renderer/utils/abortController'
import { isAbortError } from '@renderer/utils/error'
import { createMainTextBlock, createThinkingBlock } from '@renderer/utils/messageUtils/create'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { replacePromptVariables } from '@renderer/utils/prompt'
import { defaultLanguage } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { Divider } from 'antd'
import { cloneDeep, isEmpty } from 'lodash'
import { last } from 'lodash'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import ChatWindow from '../chat/ChatWindow'
import TranslateWindow from '../translate/TranslateWindow'
import ClipboardPreview from './components/ClipboardPreview'
import type { FeatureMenusRef } from './components/FeatureMenus'
import FeatureMenus from './components/FeatureMenus'
import Footer from './components/Footer'
import InputBar from './components/InputBar'

const logger = loggerService.withContext('HomeWindow')

type PetWorker = {
  label: string
  healthLabel: string
  canRun: boolean
  workload?: {
    label: string
  }
}

const HomeWindow: FC<{ draggable?: boolean }> = ({ draggable = true }) => {
  const { language, readClipboardAtStartup, windowStyle, apiServer } = useSettings()
  const { theme } = useTheme()
  const { t } = useTranslation()

  const [route, setRoute] = useState<'home' | 'chat' | 'translate' | 'summary' | 'explanation'>('home')
  const [isFirstMessage, setIsFirstMessage] = useState(true)

  const [userInputText, setUserInputText] = useState('')

  const [clipboardText, setClipboardText] = useState('')
  const lastClipboardTextRef = useRef<string | null>(null)

  const [isPinned, setIsPinned] = useState(false)

  // Indicator for loading(thinking/streaming)
  const [isLoading, setIsLoading] = useState(false)
  // Indicator for whether the first message is outputted
  const [isOutputted, setIsOutputted] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [petWorkers, setPetWorkers] = useState<PetWorker[]>([])
  const [petTaskText, setPetTaskText] = useState('')
  const [petBusy, setPetBusy] = useState(false)

  const { quickAssistantId } = useAppSelector((state) => state.llm)
  const { assistant: currentAssistant } = useAssistant(quickAssistantId)

  const currentTopic = useRef<Topic>(getDefaultTopic(currentAssistant.id))
  const currentAskId = useRef('')

  const inputBarRef = useRef<HTMLDivElement>(null)
  const featureMenusRef = useRef<FeatureMenusRef>(null)

  const referenceText = useMemo(() => clipboardText || userInputText, [clipboardText, userInputText])

  const userContent = useMemo(() => {
    if (isFirstMessage) {
      return referenceText === userInputText ? userInputText : `${referenceText}\n\n${userInputText}`.trim()
    }
    return userInputText.trim()
  }, [isFirstMessage, referenceText, userInputText])

  useEffect(() => {
    void i18n.changeLanguage(language || navigator.language || defaultLanguage)
  }, [language])

  // Reset state when switching to home route
  useEffect(() => {
    if (route === 'home') {
      setIsFirstMessage(true)
      setError(null)
    }
  }, [route])

  const focusInput = useCallback(() => {
    if (inputBarRef.current) {
      const input = inputBarRef.current.querySelector('input')
      if (input) {
        input.focus()
      }
    }
  }, [])

  // Use useCallback with stable dependencies to avoid infinite loops
  const readClipboard = useCallback(async () => {
    if (!readClipboardAtStartup || !document.hasFocus()) return

    try {
      const text = await navigator.clipboard.readText()
      if (text && text !== lastClipboardTextRef.current) {
        lastClipboardTextRef.current = text
        setClipboardText(text.trim())
      }
    } catch (error) {
      // Silently handle clipboard read errors (common in some environments)
      logger.warn('Failed to read clipboard:', error as Error)
    }
  }, [readClipboardAtStartup])

  const clearClipboard = useCallback(async () => {
    setClipboardText('')
    lastClipboardTextRef.current = null
    focusInput()
  }, [focusInput])

  const onWindowShow = useCallback(async () => {
    await readClipboard()
    focusInput()
  }, [readClipboard, focusInput])

  useEffect(() => {
    void window.api.miniWindow.setPin(isPinned)
  }, [isPinned])

  useEffect(() => {
    window.electron.ipcRenderer.on(IpcChannel.ShowMiniWindow, onWindowShow)

    return () => {
      window.electron.ipcRenderer.removeAllListeners(IpcChannel.ShowMiniWindow)
    }
  }, [onWindowShow])

  useEffect(() => {
    void readClipboard()
  }, [readClipboard])

  const apiBase = useMemo(() => `http://${apiServer.host}:${apiServer.port}`, [apiServer.host, apiServer.port])

  const loadPetWorkers = useCallback(async () => {
    if (!apiServer.enabled || !apiServer.apiKey) return
    try {
      const response = await fetch(`${apiBase}/v1/collaboration/workers`, {
        headers: { Authorization: `Bearer ${apiServer.apiKey}` }
      })
      if (!response.ok) return
      const payload = await response.json()
      setPetWorkers(Array.isArray(payload.data) ? payload.data : [])
    } catch {
      setPetWorkers([])
    }
  }, [apiBase, apiServer.apiKey, apiServer.enabled])

  useEffect(() => {
    void loadPetWorkers()
    const timer = window.setInterval(() => void loadPetWorkers(), 5000)
    return () => window.clearInterval(timer)
  }, [loadPetWorkers])

  const sendPetTask = useCallback(async () => {
    const content = petTaskText.trim()
    if (!content || !apiServer.enabled || !apiServer.apiKey) return
    setPetBusy(true)
    try {
      await fetch(`${apiBase}/mobile/api/tasks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiServer.apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          title: content.slice(0, 32) || '桌面宠物任务',
          content
        })
      })
      setPetTaskText('')
      void loadPetWorkers()
    } catch (err) {
      logger.warn('Failed to send pet task', err as Error)
    } finally {
      setPetBusy(false)
    }
  }, [apiBase, apiServer.apiKey, apiServer.enabled, loadPetWorkers, petTaskText])

  const handleCloseWindow = useCallback(() => window.api.miniWindow.hide(), [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 使用非直接输入法时（例如中文、日文输入法），存在输入法键入过程
    // 键入过程不应有任何响应
    // 例子，中文输入法候选词过程使用`Enter`直接上屏字母，日文输入法候选词过程使用`Enter`输入假名
    // 输入法可以`Esc`终止候选词过程
    // 这两个例子的`Enter`和`Esc`快捷助手都不应该响应
    if (e.nativeEvent.isComposing || e.key === 'Process') {
      return
    }

    switch (e.code) {
      case 'Enter':
      case 'NumpadEnter':
        {
          if (isLoading) return

          e.preventDefault()
          if (userContent) {
            if (route === 'home') {
              featureMenusRef.current?.useFeature()
            } else {
              // Currently text input is only available in 'chat' mode
              setRoute('chat')
              void handleSendMessage()
              focusInput()
            }
          }
        }
        break
      case 'Backspace':
        {
          if (userInputText.length === 0) {
            void clearClipboard()
          }
        }
        break
      case 'ArrowUp':
        {
          if (route === 'home') {
            e.preventDefault()
            featureMenusRef.current?.prevFeature()
          }
        }
        break
      case 'ArrowDown':
        {
          if (route === 'home') {
            e.preventDefault()
            featureMenusRef.current?.nextFeature()
          }
        }
        break
      case 'Escape':
        {
          handleEsc()
        }
        break
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUserInputText(e.target.value)
  }

  const handleError = (error: Error) => {
    setIsLoading(false)
    setError(error.message)
  }

  const handleSendMessage = useCallback(
    async (prompt?: string) => {
      if (isEmpty(userContent) || !currentTopic.current) {
        return
      }

      try {
        const topicId = currentTopic.current.id

        const { message: userMessage, blocks } = getUserMessage({
          content: [prompt, userContent].filter(Boolean).join('\n\n'),
          assistant: currentAssistant,
          topic: currentTopic.current
        })

        store.dispatch(newMessagesActions.addMessage({ topicId, message: userMessage }))
        store.dispatch(upsertManyBlocks(blocks))

        const assistantMessage = getAssistantMessage({
          assistant: currentAssistant,
          topic: currentTopic.current
        })
        assistantMessage.askId = userMessage.id
        currentAskId.current = userMessage.id

        store.dispatch(newMessagesActions.addMessage({ topicId, message: assistantMessage }))

        const allMessagesForTopic = selectMessagesForTopic(store.getState(), topicId)
        const userMessageIndex = allMessagesForTopic.findIndex((m) => m?.id === userMessage.id)

        const messagesForContext = allMessagesForTopic
          .slice(0, userMessageIndex + 1)
          .filter((m) => m && !m.status?.includes('ing'))

        let blockId: string | null = null
        let thinkingBlockId: string | null = null
        let thinkingStartTime: number | null = null

        const resolveThinkingDuration = (duration?: number) => {
          if (typeof duration === 'number' && Number.isFinite(duration)) {
            return duration
          }
          if (thinkingStartTime !== null) {
            return Math.max(0, performance.now() - thinkingStartTime)
          }
          return 0
        }

        setIsLoading(true)
        setIsOutputted(false)
        setError(null)

        setIsFirstMessage(false)
        setUserInputText('')

        const newAssistant = cloneDeep(currentAssistant)
        if (!newAssistant.settings) {
          newAssistant.settings = {}
        }
        newAssistant.settings.streamOutput = true
        // 显式关闭这些功能
        newAssistant.webSearchProviderId = undefined
        newAssistant.mcpServers = undefined
        newAssistant.knowledge_bases = undefined
        // replace prompt vars
        newAssistant.prompt = await replacePromptVariables(currentAssistant.prompt, currentAssistant?.model.name)
        // logger.debug('newAssistant', newAssistant)

        const { modelMessages, uiMessages } = await ConversationService.prepareMessagesForModel(
          messagesForContext,
          newAssistant
        )

        await fetchChatCompletion({
          messages: modelMessages,
          assistant: newAssistant,
          requestOptions: {},
          topicId,
          uiMessages: uiMessages,
          onChunkReceived: (chunk: Chunk) => {
            switch (chunk.type) {
              case ChunkType.THINKING_START:
                {
                  setIsOutputted(true)
                  thinkingStartTime = performance.now()
                  if (thinkingBlockId) {
                    store.dispatch(
                      updateOneBlock({ id: thinkingBlockId, changes: { status: MessageBlockStatus.STREAMING } })
                    )
                  } else {
                    const block = createThinkingBlock(assistantMessage.id, '', {
                      status: MessageBlockStatus.STREAMING
                    })
                    thinkingBlockId = block.id
                    store.dispatch(
                      newMessagesActions.updateMessage({
                        topicId,
                        messageId: assistantMessage.id,
                        updates: { blockInstruction: { id: block.id } }
                      })
                    )
                    store.dispatch(upsertOneBlock(block))
                  }
                }
                break
              case ChunkType.THINKING_DELTA:
                {
                  setIsOutputted(true)
                  if (thinkingBlockId) {
                    if (thinkingStartTime === null) {
                      thinkingStartTime = performance.now()
                    }
                    const thinkingDuration = resolveThinkingDuration(chunk.thinking_millsec)
                    throttledBlockUpdate(thinkingBlockId, {
                      content: chunk.text,
                      thinking_millsec: thinkingDuration
                    })
                  }
                }
                break
              case ChunkType.THINKING_COMPLETE:
                {
                  if (thinkingBlockId) {
                    const thinkingDuration = resolveThinkingDuration(chunk.thinking_millsec)
                    cancelThrottledBlockUpdate(thinkingBlockId)
                    store.dispatch(
                      updateOneBlock({
                        id: thinkingBlockId,
                        changes: { status: MessageBlockStatus.SUCCESS, thinking_millsec: thinkingDuration }
                      })
                    )
                  }
                  thinkingStartTime = null
                  thinkingBlockId = null
                }
                break
              case ChunkType.TEXT_START:
                {
                  setIsOutputted(true)
                  if (blockId) {
                    store.dispatch(updateOneBlock({ id: blockId, changes: { status: MessageBlockStatus.STREAMING } }))
                  } else {
                    const block = createMainTextBlock(assistantMessage.id, '', {
                      status: MessageBlockStatus.STREAMING
                    })
                    blockId = block.id
                    store.dispatch(
                      newMessagesActions.updateMessage({
                        topicId,
                        messageId: assistantMessage.id,
                        updates: { blockInstruction: { id: block.id } }
                      })
                    )
                    store.dispatch(upsertOneBlock(block))
                  }
                }
                break
              case ChunkType.TEXT_DELTA:
                {
                  setIsOutputted(true)
                  if (blockId) {
                    throttledBlockUpdate(blockId, { content: chunk.text })
                  }
                }
                break

              case ChunkType.TEXT_COMPLETE:
                {
                  if (blockId) {
                    cancelThrottledBlockUpdate(blockId)
                    store.dispatch(
                      updateOneBlock({
                        id: blockId,
                        changes: { content: chunk.text, status: MessageBlockStatus.SUCCESS }
                      })
                    )
                  }
                }
                break
              case ChunkType.ERROR: {
                //stop the thinking timer
                const isAborted = isAbortError(chunk.error)
                const possibleBlockId = thinkingBlockId || blockId
                if (possibleBlockId) {
                  store.dispatch(
                    updateOneBlock({
                      id: possibleBlockId,
                      changes: {
                        status: isAborted ? MessageBlockStatus.PAUSED : MessageBlockStatus.ERROR
                      }
                    })
                  )
                  store.dispatch(
                    newMessagesActions.updateMessage({
                      topicId,
                      messageId: assistantMessage.id,
                      updates: {
                        status: isAborted ? AssistantMessageStatus.PAUSED : AssistantMessageStatus.SUCCESS
                      }
                    })
                  )
                }
                if (!isAborted) {
                  throw new Error(chunk.error.message)
                }
                thinkingStartTime = null
                thinkingBlockId = null
              }
              //fall through
              case ChunkType.BLOCK_COMPLETE:
                setIsLoading(false)
                setIsOutputted(true)
                currentAskId.current = ''
                store.dispatch(
                  newMessagesActions.updateMessage({
                    topicId,
                    messageId: assistantMessage.id,
                    updates: { status: AssistantMessageStatus.SUCCESS }
                  })
                )
                break
            }
          }
        })
      } catch (err) {
        if (isAbortError(err)) return
        handleError(err instanceof Error ? err : new Error('An error occurred'))
        logger.error('Error fetching result:', err as Error)
      } finally {
        setIsLoading(false)
        setIsOutputted(true)
        currentAskId.current = ''
      }
    },
    [userContent, currentAssistant]
  )

  const handlePause = useCallback(() => {
    if (currentAskId.current) {
      abortCompletion(currentAskId.current)
      setIsLoading(false)
      setIsOutputted(true)
      currentAskId.current = ''
    }
  }, [])

  const handleEsc = useCallback(() => {
    if (isLoading) {
      handlePause()
    } else {
      if (route === 'home') {
        void handleCloseWindow()
      } else {
        // Clear the topic messages to reduce memory usage
        if (currentTopic.current) {
          store.dispatch(newMessagesActions.clearTopicMessages(currentTopic.current.id))
        }

        // Reset the topic
        currentTopic.current = getDefaultTopic(currentAssistant.id)

        // Reset selection only after using a feature and returning to home.
        featureMenusRef.current?.resetSelectedIndex()
        setError(null)
        setRoute('home')
        setUserInputText('')
      }
    }
  }, [isLoading, route, handleCloseWindow, currentAssistant.id, handlePause])

  const handleCopy = useCallback(() => {
    if (!currentTopic.current) return

    const messages = selectMessagesForTopic(store.getState(), currentTopic.current.id)
    const lastMessage = last(messages)

    if (lastMessage) {
      const content = getMainTextContent(lastMessage)
      void navigator.clipboard.writeText(content)
      window.toast.success(t('message.copy.success'))
    }
  }, [currentTopic, t])

  const backgroundColor = useMemo(() => {
    // ONLY MAC: when transparent style + light theme: use vibrancy effect
    // because the dark style under mac's vibrancy effect has not been implemented
    if (isMac && windowStyle === 'transparent' && theme === ThemeMode.light) {
      return 'transparent'
    }
    return 'var(--color-background)'
  }, [windowStyle, theme])

  // Memoize placeholder text
  const inputPlaceholder = useMemo(() => {
    if (referenceText && route === 'home') {
      return t('miniwindow.input.placeholder.title')
    }
    return t('miniwindow.input.placeholder.empty', {
      model: quickAssistantId ? currentAssistant.name : currentAssistant.model.name
    })
  }, [referenceText, route, t, quickAssistantId, currentAssistant])

  // Memoize footer props
  const baseFooterProps = useMemo(
    () => ({
      route,
      loading: isLoading,
      onEsc: handleEsc,
      setIsPinned,
      isPinned
    }),
    [route, isLoading, handleEsc, isPinned]
  )

  switch (route) {
    case 'chat':
    case 'summary':
    case 'explanation':
      return (
        <Container style={{ backgroundColor }} $draggable={draggable}>
          {route === 'chat' && (
            <>
              <InputBar
                text={userInputText}
                assistant={currentAssistant}
                referenceText={referenceText}
                placeholder={inputPlaceholder}
                loading={isLoading}
                handleKeyDown={handleKeyDown}
                handleChange={handleChange}
                ref={inputBarRef}
              />
              <Divider style={{ margin: '10px 0' }} />
            </>
          )}
          {['summary', 'explanation'].includes(route) && (
            <div style={{ marginTop: 10 }}>
              <ClipboardPreview referenceText={referenceText} clearClipboard={clearClipboard} t={t} />
            </div>
          )}
          <ChatWindow
            route={route}
            assistant={currentAssistant}
            topic={currentTopic.current}
            isOutputted={isOutputted}
          />
          {error && <ErrorMsg>{error}</ErrorMsg>}

          <Divider style={{ margin: '10px 0' }} />
          <Footer key="footer" {...baseFooterProps} onCopy={handleCopy} />
        </Container>
      )

    case 'translate':
      return (
        <Container style={{ backgroundColor }} $draggable={draggable}>
          <TranslateWindow text={referenceText} />
          <Divider style={{ margin: '10px 0' }} />
          <Footer key="footer" {...baseFooterProps} />
        </Container>
      )

    // Home
    default:
      return (
        <Container style={{ backgroundColor }} $draggable={draggable}>
          <InputBar
            text={userInputText}
            assistant={currentAssistant}
            referenceText={referenceText}
            placeholder={inputPlaceholder}
            loading={isLoading}
            handleKeyDown={handleKeyDown}
            handleChange={handleChange}
            ref={inputBarRef}
          />
          <Divider style={{ margin: '10px 0' }} />
          <ClipboardPreview referenceText={referenceText} clearClipboard={clearClipboard} t={t} />
          <PetDock>
            <PetHeader>
              <PetOrb $active={petWorkers.some((worker) => worker.canRun)} />
              <strong>Cherry 任务宠物</strong>
              <span>
                {petWorkers.filter((worker) => worker.canRun).length}/{petWorkers.length || 5} 在线
              </span>
            </PetHeader>
            <PetWorkers>
              {(petWorkers.length > 0
                ? petWorkers
                : [{ label: 'Worker', healthLabel: '等待任务台', canRun: false }]
              ).map((worker) => (
                <PetWorkerBadge key={worker.label} $active={worker.canRun}>
                  {worker.label}
                  <span>{worker.canRun ? worker.workload?.label || 'Idle' : worker.healthLabel}</span>
                </PetWorkerBadge>
              ))}
            </PetWorkers>
            <PetTaskRow>
              <input
                value={petTaskText}
                onChange={(event) => setPetTaskText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void sendPetTask()
                  }
                }}
                placeholder="快速丢一个任务..."
              />
              <button disabled={!petTaskText.trim() || petBusy} onClick={() => void sendPetTask()}>
                发送
              </button>
            </PetTaskRow>
          </PetDock>
          <Main>
            <FeatureMenus
              setRoute={setRoute}
              onSendMessage={handleSendMessage}
              text={userContent}
              ref={featureMenusRef}
            />
          </Main>
          <Divider style={{ margin: '10px 0' }} />
          <Footer
            key="footer"
            {...baseFooterProps}
            canUseBackspace={userInputText.length > 0 || clipboardText.length === 0}
            clearClipboard={clearClipboard}
          />
        </Container>
      )
  }
}

const Container = styled.div<{ $draggable: boolean }>`
  display: flex;
  flex: 1;
  height: 100%;
  width: 100%;
  flex-direction: column;
  -webkit-app-region: ${({ $draggable }) => ($draggable ? 'drag' : 'no-drag')};
  padding: 8px 10px;
`

const Main = styled.main`
  display: flex;
  flex-direction: column;

  flex: 1;
  overflow: hidden;
`

const PetDock = styled.section`
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 0.5px solid var(--color-border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-background-soft) 82%, transparent);
  padding: 9px;
  -webkit-app-region: no-drag;
`

const PetHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;

  strong {
    flex: 1;
    color: var(--color-text);
    font-size: 13px;
  }

  span {
    color: var(--color-text-3);
    font-size: 12px;
  }
`

const PetOrb = styled.span<{ $active: boolean }>`
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-border)')};
  box-shadow: ${({ $active }) => ($active ? '0 0 0 4px color-mix(in srgb, var(--color-primary) 18%, transparent)' : 'none')};
`

const PetWorkers = styled.div`
  display: flex;
  gap: 6px;
  overflow-x: auto;
`

const PetWorkerBadge = styled.div<{ $active: boolean }>`
  display: flex;
  min-width: 82px;
  flex-direction: column;
  gap: 2px;
  border: 0.5px solid ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-border)')};
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-text);
  font-size: 12px;
  padding: 6px 7px;
  white-space: nowrap;

  span {
    color: var(--color-text-3);
    font-size: 11px;
  }
`

const PetTaskRow = styled.div`
  display: flex;
  gap: 7px;

  input {
    min-width: 0;
    flex: 1;
    border: 0.5px solid var(--color-border);
    border-radius: 8px;
    background: var(--color-background);
    color: var(--color-text);
    font-size: 12px;
    outline: none;
    padding: 7px 8px;
  }

  button {
    border: 0.5px solid var(--color-primary);
    border-radius: 8px;
    background: var(--color-primary);
    color: var(--color-white);
    cursor: pointer;
    font-size: 12px;
    padding: 0 10px;

    &:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
  }
`

const ErrorMsg = styled.div`
  color: var(--color-error);
  background: rgba(255, 0, 0, 0.15);
  border: 1px solid var(--color-error);
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 12px;
  font-size: 13px;
  word-break: break-all;
`

export default HomeWindow
