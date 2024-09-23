import {
  ClearOutlined,
  ControlOutlined,
  FormOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  PauseCircleOutlined,
  QuestionCircleOutlined
} from '@ant-design/icons'
import { imageExts, textExts } from '@renderer/config/constant'
import { isVisionModel } from '@renderer/config/models'
import db from '@renderer/databases'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { useRuntime, useShowTopics } from '@renderer/hooks/useStore'
import { getDefaultTopic } from '@renderer/services/assistant'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/event'
import FileManager from '@renderer/services/file'
import { estimateTextTokens } from '@renderer/services/tokens'
import store, { useAppDispatch, useAppSelector } from '@renderer/store'
import { setGenerating, setSearching } from '@renderer/store/runtime'
import { Assistant, FileType, Message, Topic } from '@renderer/types'
import { delay, getFileExtension, uuid } from '@renderer/utils'
import { insertTextAtCursor } from '@renderer/utils/input'
import { Button, Popconfirm, Tooltip } from 'antd'
import TextArea, { TextAreaRef } from 'antd/es/input/TextArea'
import dayjs from 'dayjs'
import { debounce, isEmpty } from 'lodash'
import { CSSProperties, FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AttachmentButton from './AttachmentButton'
import AttachmentPreview from './AttachmentPreview'
import SendMessageButton from './SendMessageButton'
import TokenCount from './TokenCount'

interface Props {
  assistant: Assistant
  setActiveTopic: (topic: Topic) => void
}

let _text = ''
let _files: FileType[] = []

const Inputbar: FC<Props> = ({ assistant, setActiveTopic }) => {
  const [text, setText] = useState(_text)
  const [inputFocus, setInputFocus] = useState(false)
  const { addTopic, model } = useAssistant(assistant.id)
  const { sendMessageShortcut, fontSize, pasteLongTextAsFile } = useSettings()
  const [expended, setExpend] = useState(false)
  const [estimateTokenCount, setEstimateTokenCount] = useState(0)
  const [contextCount, setContextCount] = useState(0)
  const generating = useAppSelector((state) => state.runtime.generating)
  const textareaRef = useRef<TextAreaRef>(null)
  const [files, setFiles] = useState<FileType[]>(_files)
  const { t } = useTranslation()
  const containerRef = useRef(null)
  const { showTopics, toggleShowTopics } = useShowTopics()
  const { searching } = useRuntime()
  const dispatch = useAppDispatch()

  const isVision = useMemo(() => isVisionModel(model), [model])
  const supportExts = useMemo(() => [...textExts, ...(isVision ? imageExts : [])], [isVision])
  const inputTokenCount = useMemo(() => estimateTextTokens(text), [text])

  _text = text
  _files = files

  const sendMessage = useCallback(async () => {
    if (generating) {
      return
    }

    if (isEmpty(text.trim())) {
      return
    }

    const message: Message = {
      id: uuid(),
      role: 'user',
      content: text.replace(/\n/g, '  \n'),
      assistantId: assistant.id,
      topicId: assistant.topics[0].id || uuid(),
      createdAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      status: 'success'
    }

    if (files.length > 0) {
      message.files = await FileManager.uploadFiles(files)
    }

    EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE, message)

    setText('')
    setFiles([])
    setTimeout(() => setText(''), 500)
    setTimeout(() => resizeTextArea(), 0)

    setExpend(false)
  }, [assistant.id, assistant.topics, generating, files, text])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isEnterPressed = event.keyCode == 13

    if (expended) {
      if (event.key === 'Escape') {
        return setExpend(false)
      }
    }

    if (sendMessageShortcut === 'Enter' && isEnterPressed) {
      if (event.shiftKey) {
        return
      }
      sendMessage()
      return event.preventDefault()
    }

    if (sendMessageShortcut === 'Shift+Enter' && isEnterPressed && event.shiftKey) {
      sendMessage()
      return event.preventDefault()
    }
  }

  const addNewTopic = useCallback(() => {
    const topic = getDefaultTopic()
    addTopic(topic)
    setActiveTopic(topic)
    db.topics.add({ id: topic.id, messages: [] })
  }, [addTopic, setActiveTopic])

  const clearTopic = async () => {
    if (generating) {
      onPause()
      await delay(1)
    }
    EventEmitter.emit(EVENT_NAMES.CLEAR_MESSAGES)
  }

  const onPause = () => {
    window.keyv.set(EVENT_NAMES.CHAT_COMPLETION_PAUSED, true)
    store.dispatch(setGenerating(false))
  }

  const onNewContext = () => {
    if (generating) return onPause()
    EventEmitter.emit(EVENT_NAMES.NEW_CONTEXT)
  }

  const resizeTextArea = () => {
    const textArea = textareaRef.current?.resizableTextArea?.textArea
    if (textArea) {
      textArea.style.height = 'auto'
      textArea.style.height = textArea?.scrollHeight > 400 ? '400px' : `${textArea?.scrollHeight}px`
    }
  }

  const onToggleExpended = () => {
    const isExpended = !expended
    setExpend(isExpended)
    const textArea = textareaRef.current?.resizableTextArea?.textArea

    if (textArea) {
      if (isExpended) {
        textArea.style.height = '70vh'
      } else {
        resizeTextArea()
      }
    }

    textareaRef.current?.focus()
  }

  const onInput = () => !expended && resizeTextArea()

  const onPaste = useCallback(
    async (event: ClipboardEvent) => {
      for (const file of event.clipboardData?.files || []) {
        event.preventDefault()

        if (file.path === '') {
          if (file.type.startsWith('image/')) {
            const tempFilePath = await window.api.file.create(file.name)
            const arrayBuffer = await file.arrayBuffer()
            const uint8Array = new Uint8Array(arrayBuffer)
            await window.api.file.write(tempFilePath, uint8Array)
            const selectedFile = await window.api.file.get(tempFilePath)
            selectedFile && setFiles((prevFiles) => [...prevFiles, selectedFile])
            break
          }
        }

        if (file.path) {
          if (supportExts.includes(getFileExtension(file.path))) {
            const selectedFile = await window.api.file.get(file.path)
            selectedFile && setFiles((prevFiles) => [...prevFiles, selectedFile])
          }
        }
      }

      if (pasteLongTextAsFile) {
        const item = event.clipboardData?.items[0]
        if (item && item.kind === 'string' && item.type === 'text/plain') {
          event.preventDefault()
          item.getAsString(async (pasteText) => {
            if (pasteText.length > 1500) {
              const tempFilePath = await window.api.file.create('pasted_text.txt')
              await window.api.file.write(tempFilePath, pasteText)
              const selectedFile = await window.api.file.get(tempFilePath)
              selectedFile && setFiles((prevFiles) => [...prevFiles, selectedFile])
            } else {
              insertTextAtCursor({ text, pasteText, textareaRef, setText })
              setTimeout(() => resizeTextArea(), 0)
            }
          })
        }
      }
    },
    [pasteLongTextAsFile, supportExts, text]
  )

  // Command or Ctrl + N create new topic
  useEffect(() => {
    const onKeydown = (e) => {
      if (!generating) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
          addNewTopic()
          EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
          textareaRef.current?.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeydown)
    return () => document.removeEventListener('keydown', onKeydown)
  }, [addNewTopic, generating])

  useEffect(() => {
    const _setEstimateTokenCount = debounce(setEstimateTokenCount, 100, { leading: false, trailing: true })
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.EDIT_MESSAGE, (message: Message) => {
        setText(message.content)
        textareaRef.current?.focus()
        setTimeout(() => resizeTextArea(), 0)
      }),
      EventEmitter.on(EVENT_NAMES.ESTIMATED_TOKEN_COUNT, ({ tokensCount, contextCount }) => {
        _setEstimateTokenCount(tokensCount)
        setContextCount(contextCount)
      })
    ]
    return () => unsubscribes.forEach((unsub) => unsub())
  }, [])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [assistant])

  return (
    <Container>
      <AttachmentPreview files={files} setFiles={setFiles} />
      <InputBarContainer id="inputbar" className={inputFocus ? 'focus' : ''} ref={containerRef}>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.input.placeholder')}
          autoFocus
          contextMenu="true"
          variant="borderless"
          rows={1}
          ref={textareaRef}
          style={{ fontSize }}
          styles={{ textarea: TextareaStyle }}
          onFocus={() => setInputFocus(true)}
          onBlur={() => setInputFocus(false)}
          onInput={onInput}
          disabled={searching}
          onPaste={(e) => onPaste(e.nativeEvent)}
          onClick={() => searching && dispatch(setSearching(false))}
        />
        <Toolbar>
          <ToolbarMenu>
            <Tooltip placement="top" title={t('chat.input.new_topic')} arrow>
              <ToolbarButton type="text" onClick={addNewTopic}>
                <FormOutlined />
              </ToolbarButton>
            </Tooltip>
            <Tooltip placement="top" title={t('chat.input.clear')} arrow>
              <Popconfirm
                title={t('chat.input.clear.content')}
                placement="top"
                onConfirm={clearTopic}
                okButtonProps={{ danger: true }}
                icon={<QuestionCircleOutlined style={{ color: 'red' }} />}
                okText={t('chat.input.clear')}>
                <ToolbarButton type="text">
                  <ClearOutlined />
                </ToolbarButton>
              </Popconfirm>
            </Tooltip>
            <Tooltip placement="top" title={t('chat.input.settings')} arrow>
              <ToolbarButton
                type="text"
                onClick={() => {
                  !showTopics && toggleShowTopics()
                  setTimeout(() => EventEmitter.emit(EVENT_NAMES.SHOW_CHAT_SETTINGS), 0)
                }}>
                <ControlOutlined />
              </ToolbarButton>
            </Tooltip>
            <AttachmentButton model={model} files={files} setFiles={setFiles} ToolbarButton={ToolbarButton} />
            <Tooltip placement="top" title={expended ? t('chat.input.collapse') : t('chat.input.expand')} arrow>
              <ToolbarButton type="text" onClick={onToggleExpended}>
                {expended ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              </ToolbarButton>
            </Tooltip>
            <TokenCount
              estimateTokenCount={estimateTokenCount}
              inputTokenCount={inputTokenCount}
              contextCount={contextCount}
              ToolbarButton={ToolbarButton}
              onClick={onNewContext}
            />
          </ToolbarMenu>
          <ToolbarMenu>
            {generating && (
              <Tooltip placement="top" title={t('chat.input.pause')} arrow>
                <ToolbarButton type="text" onClick={onPause} style={{ marginRight: -2, marginTop: 1 }}>
                  <PauseCircleOutlined style={{ color: 'var(--color-error)', fontSize: 20 }} />
                </ToolbarButton>
              </Tooltip>
            )}
            {!generating && <SendMessageButton sendMessage={sendMessage} disabled={generating || !text} />}
          </ToolbarMenu>
        </Toolbar>
      </InputBarContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
`

const TextareaStyle: CSSProperties = {
  paddingLeft: 0,
  padding: '10px 15px 8px'
}

const InputBarContainer = styled.div`
  border: 1px solid var(--color-border-soft);
  transition: all 0.3s ease;
  position: relative;
  margin: 0 20px 15px 20px;
  border-radius: 10px;
`

const Textarea = styled(TextArea)`
  padding: 0;
  border-radius: 0;
  display: flex;
  flex: 1;
  font-family: Ubuntu;
  resize: vertical;
  overflow: auto;
  width: 100%;
  box-sizing: border-box;
`

const Toolbar = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 0 8px;
  padding-bottom: 0;
  margin-bottom: 4px;
  height: 36px;
`

const ToolbarMenu = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
`

const ToolbarButton = styled(Button)`
  width: 30px;
  height: 30px;
  font-size: 17px;
  border-radius: 50%;
  transition: all 0.3s ease;
  color: var(--color-icon);
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  padding: 0;
  &.anticon,
  &.iconfont {
    transition: all 0.3s ease;
    color: var(--color-icon);
  }
  .icon-a-addchat {
    font-size: 19px;
    margin-bottom: -2px;
  }
  &:hover {
    background-color: var(--color-background-soft);
    .anticon,
    .iconfont {
      color: var(--color-text-1);
    }
  }
  &.active {
    background-color: var(--color-primary) !important;
    .anticon,
    .iconfont {
      color: var(--color-white-soft);
    }
    &:hover {
      background-color: var(--color-primary);
    }
  }
`

export default Inputbar
