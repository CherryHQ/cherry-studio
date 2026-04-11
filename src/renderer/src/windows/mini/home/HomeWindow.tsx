import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { isMac } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useLightweightAssistantFlow } from '@renderer/hooks/useLightweightAssistantFlow'
import i18n from '@renderer/i18n'
import { getDefaultTopic } from '@renderer/services/AssistantService'
import { useAppSelector } from '@renderer/store'
import type { Topic } from '@renderer/types'
import { defaultLanguage } from '@shared/config/constant'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { IpcChannel } from '@shared/IpcChannel'
import { Divider } from 'antd'
import { isEmpty } from 'lodash'
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

type MiniRoute = 'home' | 'chat' | 'translate' | 'summary' | 'explanation'

const HomeWindow: FC<{ draggable?: boolean }> = ({ draggable = true }) => {
  const [readClipboardAtStartup] = usePreference('feature.quick_assistant.read_clipboard_at_startup')
  const [language] = usePreference('app.language')
  const [windowStyle] = usePreference('ui.window_style')
  const { theme } = useTheme()
  const { t } = useTranslation()

  const [route, setRoute] = useState<MiniRoute>('home')
  const [isFirstMessage, setIsFirstMessage] = useState(true)
  const [userInputText, setUserInputText] = useState('')
  const [clipboardText, setClipboardText] = useState('')
  const [isPinned, setIsPinned] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentTopic, setCurrentTopic] = useState<Topic | null>(null)

  const lastClipboardTextRef = useRef<string | null>(null)
  const inputBarRef = useRef<HTMLDivElement>(null)
  const featureMenusRef = useRef<FeatureMenusRef>(null)

  const { quickAssistantId } = useAppSelector((state) => state.llm)
  const { assistant: currentAssistant } = useAssistant(quickAssistantId)

  useEffect(() => {
    setCurrentTopic(getDefaultTopic(currentAssistant.id))
  }, [currentAssistant.id])

  const topic = currentTopic ?? getDefaultTopic(currentAssistant.id)

  const referenceText = useMemo(() => clipboardText || userInputText, [clipboardText, userInputText])

  const userContent = useMemo(() => {
    if (isFirstMessage) {
      return referenceText === userInputText ? userInputText : `${referenceText}\n\n${userInputText}`.trim()
    }
    return userInputText.trim()
  }, [isFirstMessage, referenceText, userInputText])

  const {
    adaptedMessages,
    partsMap,
    error: flowError,
    isPreparing,
    isStreaming,
    content,
    run,
    stop,
    clear
  } = useLightweightAssistantFlow({
    chatId: topic.id,
    topicId: topic.id,
    assistantId: currentAssistant.id
  })

  const isLoading = isPreparing || isStreaming
  const isOutputted = adaptedMessages.some((message) => message.role === 'assistant')

  useEffect(() => {
    void i18n.changeLanguage(language || navigator.language || defaultLanguage)
  }, [language])

  useEffect(() => {
    setError(flowError)
  }, [flowError])

  useEffect(() => {
    if (route === 'home') {
      setIsFirstMessage(true)
      setError(null)
      clear()
    }
  }, [route, clear])

  const focusInput = useCallback(() => {
    if (!inputBarRef.current) return
    const input = inputBarRef.current.querySelector('input')
    input?.focus()
  }, [])

  const readClipboard = useCallback(async () => {
    if (!readClipboardAtStartup || !document.hasFocus()) return

    try {
      const text = await navigator.clipboard.readText()
      if (text && text !== lastClipboardTextRef.current) {
        lastClipboardTextRef.current = text
        setClipboardText(text.trim())
      }
    } catch (clipboardError) {
      logger.warn('Failed to read clipboard:', clipboardError as Error)
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

  const handleCloseWindow = useCallback(() => window.api.miniWindow.hide(), [])

  const handleSendMessage = useCallback(
    async (prompt?: string) => {
      if (isEmpty(userContent)) return

      try {
        setError(null)
        setIsFirstMessage(false)
        setUserInputText('')
        await run({
          assistant: currentAssistant,
          prompt: [prompt, userContent].filter(Boolean).join('\n\n'),
          reset: false
        })
      } catch (streamError) {
        const resolvedError = streamError instanceof Error ? streamError : new Error('An error occurred')
        setError(resolvedError.message)
        logger.error('Error fetching result:', resolvedError)
      }
    },
    [currentAssistant, run, userContent]
  )

  const handlePause = useCallback(() => {
    stop()
  }, [stop])

  const resetConversation = useCallback(() => {
    setCurrentTopic(getDefaultTopic(currentAssistant.id))
    clear()
  }, [clear, currentAssistant.id])

  const handleEsc = useCallback(() => {
    if (isLoading) {
      handlePause()
      return
    }

    if (route === 'home') {
      void handleCloseWindow()
      return
    }

    resetConversation()
    featureMenusRef.current?.resetSelectedIndex()
    setError(null)
    setRoute('home')
    setUserInputText('')
  }, [handleCloseWindow, handlePause, isLoading, resetConversation, route])

  const handleCopy = useCallback(() => {
    if (!content) return
    void navigator.clipboard.writeText(content)
    window.toast.success(t('message.copy.success'))
  }, [content, t])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.key === 'Process') {
      return
    }

    switch (e.code) {
      case 'Enter':
      case 'NumpadEnter':
        if (isLoading) return
        e.preventDefault()
        if (userContent) {
          if (route === 'home') {
            featureMenusRef.current?.useFeature()
          } else {
            setRoute('chat')
            void handleSendMessage()
            focusInput()
          }
        }
        break
      case 'Backspace':
        if (userInputText.length === 0) {
          void clearClipboard()
        }
        break
      case 'ArrowUp':
        if (route === 'home') {
          e.preventDefault()
          featureMenusRef.current?.prevFeature()
        }
        break
      case 'ArrowDown':
        if (route === 'home') {
          e.preventDefault()
          featureMenusRef.current?.nextFeature()
        }
        break
      case 'Escape':
        handleEsc()
        break
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUserInputText(e.target.value)
  }

  const backgroundColor = useMemo(() => {
    if (isMac && windowStyle === 'transparent' && theme === ThemeMode.light) {
      return 'transparent'
    }
    return 'var(--color-background)'
  }, [windowStyle, theme])

  const inputPlaceholder = useMemo(() => {
    if (referenceText && route === 'home') {
      return t('miniwindow.input.placeholder.title')
    }
    return t('miniwindow.input.placeholder.empty', {
      model: quickAssistantId ? currentAssistant.name : currentAssistant.model.name
    })
  }, [referenceText, route, t, quickAssistantId, currentAssistant])

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
            isOutputted={isOutputted}
            messages={adaptedMessages}
            partsMap={partsMap}
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
