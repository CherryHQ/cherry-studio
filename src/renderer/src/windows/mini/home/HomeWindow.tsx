import { isMac } from '@renderer/config/constant'
import { useDefaultAssistant, useDefaultModel } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { uuid } from '@renderer/utils'
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
  const { defaultModel: model } = useDefaultModel()
  const { language } = useSettings()
  const { t } = useTranslation()
  const inputBarRef = useRef<HTMLDivElement>(null)
  const featureMenusRef = useRef<FeatureMenusRef>(null)

  const referenceText = selectedText || clipboardText || text

  const content = isFirstMessage ? (referenceText === text ? text : `${referenceText}\n\n${text}`).trim() : text.trim()

  const readClipboard = useCallback(async () => {
    const text = await navigator.clipboard.readText().catch(() => null)
    if (text && text !== lastClipboardText) {
      setLastClipboardText(text)
      setClipboardText(text.trim())
    }
  }, [lastClipboardText])

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
    i18n.changeLanguage(language || navigator.language || 'en-US')
  }, [language])

  const onCloseWindow = () => window.api.miniWindow.hide()

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 使用非直接输入法时（例如中文、日文输入法），存在输入法键入过程
    // 键入过程不应有任何响应
    // 例子，中文输入法候选词过程使用`Enter`直接上屏字母，日文输入法候选词过程使用`Enter`输入假名
    // 输入法可以`Esc`终止候选词过程
    // 这两个例子的`Enter`和`Esc`快捷助手都不应该响应
    if (e.key === 'Process') {
      return
    }

    switch (e.code) {
      case 'Enter':
        {
          e.preventDefault()
          if (content) {
            if (route === 'home') {
              featureMenusRef.current?.useFeature()
              setText('')
            } else {
              // 目前文本框只在'chat'时可以继续输入，这里相当于 route === 'chat'
              setRoute('chat')
              onSendMessage().then()
              focusInput()
              setTimeout(() => setText(''), 100)
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

      setTimeout(() => {
        const message = {
          id: uuid(),
          role: 'user',
          content: prompt ? `${prompt}\n\n${content}` : content,
          assistantId: defaultAssistant.id,
          topicId: defaultAssistant.topics[0].id || uuid(),
          createdAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
          type: 'text',
          status: 'success'
        }
        EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE, message)
        setIsFirstMessage(false)
      }, 0)
    },
    [content, defaultAssistant.id, defaultAssistant.topics]
  )

  const clearClipboard = () => {
    setClipboardText('')
    setSelectedText('')
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
    window.electron.ipcRenderer.on('show-mini-window', onWindowShow)
    window.electron.ipcRenderer.on('selection-action', (_, { action, selectedText }) => {
      selectedText && setSelectedText(selectedText)
      action && setRoute(action)
      action === 'chat' && onSendMessage()
    })

    return () => {
      window.electron.ipcRenderer.removeAllListeners('show-mini-window')
      window.electron.ipcRenderer.removeAllListeners('selection-action')
    }
  }, [onWindowShow, onSendMessage, setRoute])

  // 当路由为home时，初始化isFirstMessage为true
  useEffect(() => {
    if (route === 'home') {
      setIsFirstMessage(true)
    }
  }, [route])

  if (['chat', 'summary', 'explanation'].includes(route)) {
    return (
      <Container>
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
        <ChatWindow route={route} />
        <Divider style={{ margin: '10px 0' }} />
        <Footer route={route} onExit={() => setRoute('home')} />
      </Container>
    )
  }

  if (route === 'translate') {
    return (
      <Container>
        <TranslateWindow text={referenceText} />
        <Divider style={{ margin: '10px 0' }} />
        <Footer route={route} onExit={() => setRoute('home')} />
      </Container>
    )
  }

  return (
    <Container>
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
  flex-direction: column;
  -webkit-app-region: drag;
  padding: 8px 10px;
  background-color: ${isMac ? 'transparent' : 'var(--color-background)'};
`

const Main = styled.main`
  display: flex;
  flex: 1;
  overflow: hidden;
`

export default HomeWindow
