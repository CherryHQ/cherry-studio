import { isMac } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useDefaultAssistant, useDefaultModel } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import { fetchChatCompletion } from '@renderer/services/ApiService'
import { getDefaultAssistant, getDefaultModel } from '@renderer/services/AssistantService'
import { getAssistantMessage, getUserMessage } from '@renderer/services/MessagesService'
import store from '@renderer/store'
import { upsertManyBlocks } from '@renderer/store/messageBlock'
import { updateOneBlock, upsertOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions } from '@renderer/store/newMessage'
import { ThemeMode } from '@renderer/types'
import { Chunk, ChunkType } from '@renderer/types/chunk'
import { AssistantMessageStatus } from '@renderer/types/newMessage'
import { MessageBlockStatus } from '@renderer/types/newMessage'
import { createMainTextBlock } from '@renderer/utils/messageUtils/create'
import { defaultLanguage } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { Divider } from 'antd'
import dayjs from 'dayjs'
import { isEmpty } from 'lodash'
import React, { FC, useCallback, useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import ChatWindow from '../chat/ChatWindow'
import TranslateWindow from '../translate/TranslateWindow'
import ClipboardPreview from './components/ClipboardPreview'
import FeatureMenus, { FeatureMenusRef } from './components/FeatureMenus'
import Footer from './components/Footer'
import InputBar from './components/InputBar'

const HomeWindow: FC = () => {
  const [route, setRoute] = useState<'home' | 'chat' | 'translate' | 'summary' | 'explanation'>('home')
  const [isFirstMessage, setIsFirstMessage] = useState(true)
  const [clipboardText, setClipboardText] = useState('')
  const [selectedText, setSelectedText] = useState('')
  const [text, setText] = useState('')
  const [lastClipboardText, setLastClipboardText] = useState<string | null>(null)
  const textChange = useState(() => {})[1]
  const { defaultAssistant } = useDefaultAssistant()
  const topic = defaultAssistant.topics[0]
  const { defaultModel, quickAssistantModel } = useDefaultModel()
  // 如果 quickAssistantModel 未設定，則使用 defaultModel
  const model = quickAssistantModel || defaultModel
  const { language, readClipboardAtStartup, windowStyle } = useSettings()
  const { theme } = useTheme()
  const { t } = useTranslation()
  const inputBarRef = useRef<HTMLDivElement>(null)
  const featureMenusRef = useRef<FeatureMenusRef>(null)
  const referenceText = selectedText || clipboardText || text

  const content = isFirstMessage ? (referenceText === text ? text : `${referenceText}\n\n${text}`).trim() : text.trim()

  const readClipboard = useCallback(async () => {
    if (!readClipboardAtStartup) return

    const text = await navigator.clipboard.readText().catch(() => null)
    if (text && text !== lastClipboardText) {
      setLastClipboardText(text)
      setClipboardText(text.trim())
    }
  }, [readClipboardAtStartup, lastClipboardText])

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
    readClipboard()
  }, [readClipboard])

  useEffect(() => {
    i18n.changeLanguage(language || navigator.language || defaultLanguage)
  }, [language])

  const onCloseWindow = () => window.api.miniWindow.hide()

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
              onSendMessage().then()
              focusInput()
            }
          }
        }
        break
      case 'Backspace':
        {
          textChange(() => {
            if (text.length === 0) {
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
          setText('')
          setRoute('home')
          route === 'home' && onCloseWindow()
        }
        break
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value)
  }

  const onSendMessage = useCallback(
    async (prompt?: string) => {
      if (isEmpty(content)) {
        return
      }

      const messageParams = {
        role: 'user',
        content: prompt ? `${prompt}\n\n${content}` : content,
        assistant: defaultAssistant,
        topic,
        createdAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        status: 'success'
      }
      const topicId = topic.id
      const { message: userMessage, blocks } = getUserMessage(messageParams)

      store.dispatch(newMessagesActions.addMessage({ topicId, message: userMessage }))
      store.dispatch(upsertManyBlocks(blocks))

      const assistant = getDefaultAssistant()
      let blockId: string | null = null
      let blockContent: string = ''

      const assistantMessage = getAssistantMessage({ assistant, topic: assistant.topics[0] })
      store.dispatch(newMessagesActions.addMessage({ topicId, message: assistantMessage }))

      fetchChatCompletion({
        messages: [userMessage],
        assistant: { ...assistant, model: quickAssistantModel || getDefaultModel() },
        onChunkReceived: (chunk: Chunk) => {
          if (chunk.type === ChunkType.TEXT_DELTA) {
            blockContent += chunk.text
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
          if (chunk.type === ChunkType.TEXT_COMPLETE) {
            blockId && store.dispatch(updateOneBlock({ id: blockId, changes: { status: MessageBlockStatus.SUCCESS } }))
            store.dispatch(
              newMessagesActions.updateMessage({
                topicId,
                messageId: assistantMessage.id,
                updates: { status: AssistantMessageStatus.SUCCESS }
              })
            )
          }
        }
      })

      setIsFirstMessage(false)
      setText('') // ✅ 清除输入框内容
    },
    [content, defaultAssistant, topic, quickAssistantModel]
  )

  const clearClipboard = () => {
    setClipboardText('')
    setSelectedText('')
    focusInput()
  }

  // If the input is focused, the `Esc` callback will not be triggered here.
  useHotkeys('esc', () => {
    if (route === 'home') {
      onCloseWindow()
    } else {
      setRoute('home')
      setText('')
    }
  })

  useEffect(() => {
    window.electron.ipcRenderer.on(IpcChannel.ShowMiniWindow, onWindowShow)

    return () => {
      window.electron.ipcRenderer.removeAllListeners(IpcChannel.ShowMiniWindow)
    }
  }, [onWindowShow, onSendMessage, setRoute])

  // 当路由为home时，初始化isFirstMessage为true
  useEffect(() => {
    if (route === 'home') {
      setIsFirstMessage(true)
    }
  }, [route])

  const backgroundColor = () => {
    // ONLY MAC: when transparent style + light theme: use vibrancy effect
    // because the dark style under mac's vibrancy effect has not been implemented
    if (isMac && windowStyle === 'transparent' && theme === ThemeMode.light) {
      return 'transparent'
    }

    return 'var(--color-background)'
  }

  if (['chat', 'summary', 'explanation'].includes(route)) {
    return (
      <Container style={{ backgroundColor: backgroundColor() }}>
        {route === 'chat' && (
          <>
            <InputBar
              text={text}
              model={model}
              referenceText={referenceText}
              placeholder={t('miniwindow.input.placeholder.empty', { model: model.name })}
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
        <ChatWindow route={route} assistant={defaultAssistant} />
        <Divider style={{ margin: '10px 0' }} />
        <Footer route={route} onExit={() => setRoute('home')} />
      </Container>
    )
  }

  if (route === 'translate') {
    return (
      <Container style={{ backgroundColor: backgroundColor() }}>
        <TranslateWindow text={referenceText} />
        <Divider style={{ margin: '10px 0' }} />
        <Footer route={route} onExit={() => setRoute('home')} />
      </Container>
    )
  }

  return (
    <Container style={{ backgroundColor: backgroundColor() }}>
      <InputBar
        text={text}
        model={model}
        referenceText={referenceText}
        placeholder={
          referenceText && route === 'home'
            ? t('miniwindow.input.placeholder.title')
            : t('miniwindow.input.placeholder.empty', { model: model.name })
        }
        handleKeyDown={handleKeyDown}
        handleChange={handleChange}
        ref={inputBarRef}
      />
      <Divider style={{ margin: '10px 0' }} />
      <ClipboardPreview referenceText={referenceText} clearClipboard={clearClipboard} t={t} />
      <Main>
        <FeatureMenus setRoute={setRoute} onSendMessage={onSendMessage} text={content} ref={featureMenusRef} />
      </Main>
      <Divider style={{ margin: '10px 0' }} />
      <Footer
        route={route}
        canUseBackspace={text.length > 0 || clipboardText.length == 0}
        clearClipboard={clearClipboard}
        onExit={() => {
          setRoute('home')
          setText('')
          onCloseWindow()
        }}
      />
    </Container>
  )
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
