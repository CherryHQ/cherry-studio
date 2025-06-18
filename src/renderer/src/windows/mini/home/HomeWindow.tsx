import { isMac } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import { fetchChatCompletion } from '@renderer/services/ApiService'
import {
  getAssistantById,
  getDefaultAssistant,
  getDefaultModel,
  getDefaultTopic
} from '@renderer/services/AssistantService'
import { getAssistantMessage, getUserMessage } from '@renderer/services/MessagesService'
import store, { useAppSelector } from '@renderer/store'
import { upsertManyBlocks } from '@renderer/store/messageBlock'
import { updateOneBlock, upsertOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions } from '@renderer/store/newMessage'
import { selectMessagesForTopic } from '@renderer/store/newMessage'
import { Assistant, ThemeMode, Topic } from '@renderer/types'
import { Chunk, ChunkType } from '@renderer/types/chunk'
import { AssistantMessageStatus } from '@renderer/types/newMessage'
import { MessageBlockStatus } from '@renderer/types/newMessage'
import { abortCompletion } from '@renderer/utils/abortController'
import { isAbortError } from '@renderer/utils/error'
import { createMainTextBlock, createThinkingBlock } from '@renderer/utils/messageUtils/create'
import { defaultLanguage } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { Divider } from 'antd'
import { isEmpty } from 'lodash'
import React, { FC, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import ChatWindow from '../chat/ChatWindow'
import TranslateWindow from '../translate/TranslateWindow'
import ClipboardPreview from './components/ClipboardPreview'
import FeatureMenus, { FeatureMenusRef } from './components/FeatureMenus'
import Footer from './components/Footer'
import InputBar from './components/InputBar'

const HomeWindow: FC = () => {
  const { language, readClipboardAtStartup, windowStyle } = useSettings()
  const { theme } = useTheme()
  const { t } = useTranslation()

  const [route, setRoute] = useState<'home' | 'chat' | 'translate' | 'summary' | 'explanation'>('home')
  const [isFirstMessage, setIsFirstMessage] = useState(true)
  const [clipboardText, setClipboardText] = useState('')
  const [selectedText, setSelectedText] = useState('')

  const [userInputText, setUserInputText] = useState('')
  const [lastClipboardText, setLastClipboardText] = useState<string | null>(null)
  const textChange = useState(() => {})[1]

  //indicator for loading(thinking/streaming)
  const [isLoading, setIsLoading] = useState(false)
  //indicator for wether the first message is outputted
  const [isOutputted, setIsOutputted] = useState(false)

  const { quickAssistantId } = useAppSelector((state) => state.llm)
  const currentAssistant = useRef<Assistant | null>(null)
  const currentTopic = useRef<Topic | null>(null)
  const currentAskId = useRef('')

  const inputBarRef = useRef<HTMLDivElement>(null)
  const featureMenusRef = useRef<FeatureMenusRef>(null)
  const referenceText = selectedText || clipboardText || userInputText

  const content = isFirstMessage
    ? (referenceText === userInputText ? userInputText : `${referenceText}\n\n${userInputText}`).trim()
    : userInputText.trim()

  //init the assistant and topic
  useEffect(() => {
    if (quickAssistantId) {
      currentAssistant.current = getAssistantById(quickAssistantId) || getDefaultAssistant()
    } else {
      currentAssistant.current = getDefaultAssistant()
    }

    if (!currentAssistant.current?.model) {
      currentAssistant.current.model = getDefaultModel()
    }
    currentTopic.current = getDefaultTopic(currentAssistant.current?.id)
  }, [quickAssistantId])

  useEffect(() => {
    i18n.changeLanguage(language || navigator.language || defaultLanguage)
  }, [language])

  // 当路由为home时，初始化isFirstMessage为true
  useEffect(() => {
    if (route === 'home') {
      setIsFirstMessage(true)
    }
  }, [route])

  const readClipboard = useCallback(async () => {
    if (!readClipboardAtStartup) return

    const text = await navigator.clipboard.readText().catch(() => null)
    if (text && text !== lastClipboardText) {
      setLastClipboardText(text)
      setClipboardText(text.trim())
    }
  }, [readClipboardAtStartup, lastClipboardText])

  const clearClipboard = () => {
    setClipboardText('')
    setSelectedText('')
    focusInput()
  }

  const focusInput = () => {
    if (inputBarRef.current) {
      const input = inputBarRef.current.querySelector('input')
      if (input) {
        input.focus()
      }
    }
  }

  const onWindowShow = useCallback(async () => {
    featureMenusRef.current?.resetSelectedIndex()
    readClipboard().then()
    focusInput()
  }, [readClipboard])

  useEffect(() => {
    window.electron.ipcRenderer.on(IpcChannel.ShowMiniWindow, onWindowShow)

    return () => {
      window.electron.ipcRenderer.removeAllListeners(IpcChannel.ShowMiniWindow)
    }
  }, [onWindowShow])

  useEffect(() => {
    readClipboard()
  }, [readClipboard])

  const handleCloseWindow = () => window.api.miniWindow.hide()

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 使用非直接输入法时（例如中文、日文输入法），存在输入法键入过程
    // 键入过程不应有任何响应
    // 例子，中文输入法候选词过程使用`Enter`直接上屏字母，日文输入法候选词过程使用`Enter`输入假名
    // 输入法可以`Esc`终止候选词过程
    // 这两个例子的`Enter`和`Esc`快捷助手都不应该响应
    if (e.nativeEvent.isComposing) {
      return
    }
    if (e.key === 'Process') {
      return
    }

    switch (e.code) {
      case 'Enter':
      case 'NumpadEnter':
        {
          e.preventDefault()
          if (content) {
            if (route === 'home') {
              featureMenusRef.current?.useFeature()
            } else {
              // 目前文本框只在'chat'时可以继续输入，这里相当于 route === 'chat'
              setRoute('chat')
              handleSendMessage().then()
              focusInput()
            }
          }
        }
        break
      case 'Backspace':
        {
          textChange(() => {
            if (userInputText.length === 0) {
              clearClipboard()
            }
          })
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

  const handleSendMessage = useCallback(
    async (prompt?: string) => {
      if (isEmpty(content) || !currentAssistant.current || !currentTopic.current) {
        return
      }

      try {
        const topicId = currentTopic.current.id

        const { message: userMessage, blocks } = getUserMessage({
          content: [prompt, content].filter(Boolean).join('\n\n'),
          assistant: currentAssistant.current,
          topic: currentTopic.current
        })

        store.dispatch(newMessagesActions.addMessage({ topicId, message: userMessage }))
        store.dispatch(upsertManyBlocks(blocks))

        const assistantMessage = getAssistantMessage({
          assistant: currentAssistant.current,
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
        let blockContent: string = ''
        let thinkingBlockId: string | null = null
        let thinkingBlockContent: string = ''

        setIsLoading(true)
        setIsOutputted(false)

        setIsFirstMessage(false)
        setUserInputText('')

        await fetchChatCompletion({
          messages: messagesForContext,
          assistant: { ...currentAssistant.current, settings: { streamOutput: true } },
          onChunkReceived: (chunk: Chunk) => {
            switch (chunk.type) {
              case ChunkType.THINKING_DELTA:
                {
                  thinkingBlockContent += chunk.text
                  setIsOutputted(true)
                  if (!thinkingBlockId) {
                    const block = createThinkingBlock(assistantMessage.id, chunk.text, {
                      status: MessageBlockStatus.STREAMING,
                      thinking_millsec: chunk.thinking_millsec
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
                  } else {
                    store.dispatch(
                      updateOneBlock({
                        id: thinkingBlockId,
                        changes: { content: thinkingBlockContent, thinking_millsec: chunk.thinking_millsec }
                      })
                    )
                  }
                }
                break
              case ChunkType.THINKING_COMPLETE:
                {
                  if (thinkingBlockId) {
                    store.dispatch(
                      updateOneBlock({
                        id: thinkingBlockId,
                        changes: { status: MessageBlockStatus.SUCCESS, thinking_millsec: chunk.thinking_millsec }
                      })
                    )
                  }
                }
                break
              case ChunkType.TEXT_DELTA:
                {
                  blockContent += chunk.text
                  setIsOutputted(true)
                  if (!blockId) {
                    const block = createMainTextBlock(assistantMessage.id, chunk.text, {
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
                  } else {
                    store.dispatch(updateOneBlock({ id: blockId, changes: { content: blockContent } }))
                  }
                }
                break

              case ChunkType.TEXT_COMPLETE:
                {
                  blockId &&
                    store.dispatch(updateOneBlock({ id: blockId, changes: { status: MessageBlockStatus.SUCCESS } }))
                  store.dispatch(
                    newMessagesActions.updateMessage({
                      topicId,
                      messageId: assistantMessage.id,
                      updates: { status: AssistantMessageStatus.SUCCESS }
                    })
                  )
                }
                break
              case ChunkType.BLOCK_COMPLETE:
              case ChunkType.ERROR:
                setIsLoading(false)
                setIsOutputted(true)
                currentAskId.current = ''
                break
            }
          }
        })
      } catch (err) {
        if (isAbortError(err)) return
        // onError(err instanceof Error ? err : new Error('An error occurred'))
        console.error('Error fetching result:', err)
      } finally {
        setIsLoading(false)
        setIsOutputted(true)
        currentAskId.current = ''
      }
    },
    [content, currentAssistant]
  )

  const handleEsc = () => {
    if (isLoading) {
      handlePause()
    } else {
      if (route === 'home') {
        handleCloseWindow()
      } else {
        //if we go back to home, we should clear the topic

        //clear the topic messages in order to reduce memory usage
        store.dispatch(newMessagesActions.clearTopicMessages(currentTopic.current!.id))

        //reset the topic
        if (currentAssistant.current?.id) {
          currentTopic.current = getDefaultTopic(currentAssistant.current.id)
        }

        setRoute('home')
        setUserInputText('')
      }
    }
  }

  const handlePause = () => {
    if (currentAskId.current) {
      // const topicId = currentTopic.current!.id

      // const topicMessages = selectMessagesForTopic(store.getState(), topicId)
      // if (!topicMessages) return

      // const streamingMessages = topicMessages.filter((m) => m.status === 'processing' || m.status === 'pending')
      // const askIds = [...new Set(streamingMessages?.map((m) => m.askId).filter((id) => !!id) as string[])]

      // for (const askId of askIds) {
      //   abortCompletion(askId)
      // }
      // store.dispatch(newMessagesActions.setTopicLoading({ topicId: topicId, loading: false }))

      abortCompletion(currentAskId.current)
      // store.dispatch(newMessagesActions.setTopicLoading({ topicId: currentTopic.current!.id, loading: false }))
      setIsLoading(false)
      setIsOutputted(true)
      currentAskId.current = ''
    }
  }

  const backgroundColor = () => {
    // ONLY MAC: when transparent style + light theme: use vibrancy effect
    // because the dark style under mac's vibrancy effect has not been implemented
    if (isMac && windowStyle === 'transparent' && theme === ThemeMode.light) {
      return 'transparent'
    }
    return 'var(--color-background)'
  }

  switch (route) {
    case 'chat':
    case 'summary':
    case 'explanation':
      return (
        <Container style={{ backgroundColor: backgroundColor() }}>
          {route === 'chat' && (
            <>
              <InputBar
                text={userInputText}
                model={currentAssistant.current?.model}
                referenceText={referenceText}
                placeholder={t('miniwindow.input.placeholder.empty', {
                  model: quickAssistantId ? currentAssistant.current?.name : getDefaultModel().name
                })}
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
            assistant={currentAssistant.current!}
            topic={currentTopic.current!}
            isOutputted={isOutputted}
          />
          <Divider style={{ margin: '10px 0' }} />
          <Footer key="footer" route={route} loading={isLoading} onEsc={handleEsc} />
        </Container>
      )

    case 'translate':
      return (
        <Container style={{ backgroundColor: backgroundColor() }}>
          <TranslateWindow text={referenceText} />
          <Divider style={{ margin: '10px 0' }} />
          <Footer key="footer" route={route} onEsc={handleEsc} />
        </Container>
      )

    //Home
    default:
      return (
        <Container style={{ backgroundColor: backgroundColor() }}>
          <InputBar
            text={userInputText}
            model={currentAssistant.current?.model}
            referenceText={referenceText}
            placeholder={
              referenceText && route === 'home'
                ? t('miniwindow.input.placeholder.title')
                : t('miniwindow.input.placeholder.empty', {
                    model: quickAssistantId ? currentAssistant.current?.name : getDefaultModel().name
                  })
            }
            loading={isLoading}
            handleKeyDown={handleKeyDown}
            handleChange={handleChange}
            ref={inputBarRef}
          />
          <Divider style={{ margin: '10px 0' }} />
          <ClipboardPreview referenceText={referenceText} clearClipboard={clearClipboard} t={t} />
          <Main>
            <FeatureMenus setRoute={setRoute} onSendMessage={handleSendMessage} text={content} ref={featureMenusRef} />
          </Main>
          <Divider style={{ margin: '10px 0' }} />
          <Footer
            key="footer"
            route={route}
            canUseBackspace={userInputText.length > 0 || clipboardText.length == 0}
            loading={isLoading}
            clearClipboard={clearClipboard}
            onEsc={handleEsc}
          />
        </Container>
      )
  }
}

const Container = styled.div`
  display: flex;
  flex: 1;
  height: 100%;
  width: 100%;
  flex-direction: column;
  -webkit-app-region: drag;
  padding: 8px 10px;
`

const Main = styled.main`
  display: flex;
  flex-direction: column;

  flex: 1;
  overflow: hidden;
`

export default HomeWindow
