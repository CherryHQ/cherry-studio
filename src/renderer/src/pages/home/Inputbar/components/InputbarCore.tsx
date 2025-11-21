import { HolderOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { ActionIconButton } from '@renderer/components/Buttons'
import type { QuickPanelTriggerInfo } from '@renderer/components/QuickPanel'
import { QuickPanelReservedSymbol, QuickPanelView, useQuickPanel } from '@renderer/components/QuickPanel'
import TranslateButton from '@renderer/components/TranslateButton'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTimer } from '@renderer/hooks/useTimer'
import useTranslate from '@renderer/hooks/useTranslate'
import PasteService from '@renderer/services/PasteService'
import { translateText } from '@renderer/services/TranslateService'
import { useAppDispatch } from '@renderer/store'
import { setSearching } from '@renderer/store/runtime'
import type { FileType } from '@renderer/types'
import { classNames } from '@renderer/utils'
import { formatQuotedText } from '@renderer/utils/formats'
import { isSendMessageKeyPressed } from '@renderer/utils/input'
import { IpcChannel } from '@shared/IpcChannel'
import { Tooltip } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { CirclePause, Languages } from 'lucide-react'
import type { CSSProperties, FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import NarrowLayout from '../../Messages/NarrowLayout'
import AttachmentPreview from '../AttachmentPreview'
import {
  useInputbarToolsDispatch,
  useInputbarToolsInternalDispatch,
  useInputbarToolsState
} from '../context/InputbarToolsProvider'
import { useFileDragDrop } from '../hooks/useFileDragDrop'
import { usePasteHandler } from '../hooks/usePasteHandler'
import { getInputbarConfig } from '../registry'
import SendMessageButton from '../SendMessageButton'
import type { InputbarScope } from '../types'

const logger = loggerService.withContext('InputbarCore')

export interface InputbarCoreProps {
  scope: InputbarScope
  placeholder?: string

  text: string
  onTextChange: (text: string) => void
  textareaRef: React.RefObject<any>
  resizeTextArea: (force?: boolean) => void
  focusTextarea: () => void

  supportedExts: string[]
  isLoading: boolean

  onPause?: () => void
  handleSendMessage: () => void

  // Toolbar sections
  leftToolbar?: React.ReactNode
  rightToolbar?: React.ReactNode

  // Preview sections (attachments, mentions, etc.)
  topContent?: React.ReactNode

  // Override the user preference for quick panel triggers
  forceEnableQuickPanelTriggers?: boolean
}

const TextareaStyle: CSSProperties = {
  paddingLeft: 0,
  padding: '6px 15px 0px'
}

/**
 * InputbarCore - 核心输入栏组件
 *
 * 提供基础的文本输入、工具栏、拖拽等功能的 UI 框架
 * 业务逻辑通过 props 注入，保持组件纯粹
 *
 * @example
 * ```tsx
 * <InputbarCore
 *   text={text}
 *   onTextChange={(e) => setText(e.target.value)}
 *   textareaRef={textareaRef}
 *   textareaHeight={customHeight}
 *   onKeyDown={handleKeyDown}
 *   onPaste={handlePaste}
 *   topContent={<AttachmentPreview files={files} />}
 *   leftToolbar={<InputbarTools />}
 *   rightToolbar={<SendMessageButton />}
 *   quickPanel={<QuickPanelView />}
 *   fontSize={14}
 *   enableSpellCheck={true}
 * />
 * ```
 */
export const InputbarCore: FC<InputbarCoreProps> = ({
  scope,
  placeholder,
  text,
  onTextChange,
  textareaRef,
  resizeTextArea,
  focusTextarea,
  supportedExts,
  isLoading,
  onPause,
  handleSendMessage,
  leftToolbar,
  rightToolbar,
  topContent,
  forceEnableQuickPanelTriggers
}) => {
  const config = useMemo(() => getInputbarConfig(scope), [scope])
  const { files, isExpanded } = useInputbarToolsState()
  const { setFiles, setIsExpanded, toolsRegistry, triggers } = useInputbarToolsDispatch()
  const { setExtensions } = useInputbarToolsInternalDispatch()
  const isEmpty = text.trim().length === 0
  const [inputFocus, setInputFocus] = useState(false)
  const {
    targetLanguage,
    sendMessageShortcut,
    fontSize,
    pasteLongTextAsFile,
    pasteLongTextThreshold,
    autoTranslateWithSpace,
    enableQuickPanelTriggers,
    enableSpellCheck
  } = useSettings()
  const quickPanelTriggersEnabled = forceEnableQuickPanelTriggers ?? enableQuickPanelTriggers

  const [textareaHeight, setTextareaHeight] = useState<number>()

  const { t } = useTranslation()
  const [isTranslating, setIsTranslating] = useState(false)
  const { getLanguageByLangcode } = useTranslate()

  const dispatch = useAppDispatch()
  const [spaceClickCount, setSpaceClickCount] = useState(0)
  const spaceClickTimer = useRef<NodeJS.Timeout | null>(null)
  const { searching } = useRuntime()
  const startDragY = useRef<number>(0)
  const startHeight = useRef<number>(0)
  const { setTimeoutTimer } = useTimer()

  // 全局 QuickPanel Hook (用于控制面板显示状态)
  const quickPanel = useQuickPanel()
  const quickPanelOpen = quickPanel.open

  const textRef = useRef(text)
  useEffect(() => {
    textRef.current = text
  }, [text])

  const setText = useCallback<React.Dispatch<React.SetStateAction<string>>>(
    (value) => {
      if (typeof value === 'function') {
        onTextChange(value(textRef.current))
      } else {
        onTextChange(value)
      }
    },
    [onTextChange]
  )

  const { handlePaste } = usePasteHandler(text, setText, {
    supportedExts,
    setFiles,
    pasteLongTextAsFile,
    pasteLongTextThreshold,
    onResize: resizeTextArea,
    t
  })

  const { handleDragEnter, handleDragLeave, handleDragOver, handleDrop, isDragging } = useFileDragDrop({
    supportedExts,
    setFiles,
    onTextDropped: (droppedText) => setText((prev) => prev + droppedText),
    enabled: config.enableDragDrop,
    t
  })
  // 判断是否可以发送：文本不为空或有文件
  const cannotSend = isEmpty && files.length === 0

  useEffect(() => {
    setExtensions(supportedExts)
  }, [setExtensions, supportedExts])

  const handleToggleExpanded = useCallback(
    (nextState?: boolean) => {
      const target = typeof nextState === 'boolean' ? nextState : !isExpanded
      setIsExpanded(target)
      focusTextarea()
    },
    [focusTextarea, setIsExpanded, isExpanded]
  )

  const translate = useCallback(async () => {
    if (isTranslating) {
      return
    }

    try {
      setIsTranslating(true)
      const translatedText = await translateText(text, getLanguageByLangcode(targetLanguage))
      translatedText && setText(translatedText)
      setTimeoutTimer('translate', () => resizeTextArea(), 0)
    } catch (error) {
      logger.warn('Translation failed:', error as Error)
    } finally {
      setIsTranslating(false)
    }
  }, [getLanguageByLangcode, isTranslating, resizeTextArea, setText, setTimeoutTimer, targetLanguage, text])

  const rootTriggerHandlerRef = useRef<((payload?: unknown) => void) | undefined>(undefined)

  useEffect(() => {
    rootTriggerHandlerRef.current = (payload) => {
      const menuItems = triggers.getRootMenu()

      if (text.trim()) {
        menuItems.push({
          label: t('translate.title'),
          description: t('translate.menu.description'),
          icon: <Languages size={16} />,
          action: () => translate()
        })
      }

      if (!menuItems.length) {
        return
      }

      const triggerInfo = (payload ?? {}) as QuickPanelTriggerInfo
      quickPanelOpen({
        title: t('settings.quickPanel.title'),
        list: menuItems,
        symbol: QuickPanelReservedSymbol.Root,
        triggerInfo
      })
    }
  }, [triggers, quickPanelOpen, t, text, translate])

  useEffect(() => {
    if (!config.enableQuickPanel) {
      return
    }

    const disposeRootTrigger = toolsRegistry.registerTrigger(
      'inputbar-root',
      QuickPanelReservedSymbol.Root,
      (payload) => rootTriggerHandlerRef.current?.(payload)
    )

    return () => {
      disposeRootTrigger()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.enableQuickPanel])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Tab' && inputFocus) {
        event.preventDefault()
        const textArea = textareaRef.current?.resizableTextArea?.textArea
        if (!textArea) {
          return
        }
        const cursorPosition = textArea.selectionStart
        const selectionLength = textArea.selectionEnd - textArea.selectionStart
        const text = textArea.value

        let match = text.slice(cursorPosition + selectionLength).match(/\$\{[^}]+\}/)
        let startIndex: number

        if (!match) {
          match = text.match(/\$\{[^}]+\}/)
          startIndex = match?.index ?? -1
        } else {
          startIndex = cursorPosition + selectionLength + match.index!
        }

        if (startIndex !== -1) {
          const endIndex = startIndex + match![0].length
          textArea.setSelectionRange(startIndex, endIndex)
          return
        }
      }
      if (autoTranslateWithSpace && event.key === ' ') {
        setSpaceClickCount((prev) => prev + 1)
        if (spaceClickTimer.current) {
          clearTimeout(spaceClickTimer.current)
        }
        spaceClickTimer.current = setTimeout(() => {
          setSpaceClickCount(0)
        }, 200)

        if (spaceClickCount === 2) {
          logger.info('Triple space detected - trigger translation')
          setSpaceClickCount(0)
          translate()
          return
        }
      }

      if (isExpanded && event.key === 'Escape') {
        event.stopPropagation()
        handleToggleExpanded()
        return
      }

      const isEnterPressed = event.key === 'Enter' && !event.nativeEvent.isComposing
      if (isEnterPressed) {
        if (isSendMessageKeyPressed(event, sendMessageShortcut) && !cannotSend) {
          handleSendMessage()
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
            'handleKeyDown',
            () => {
              textArea.selectionStart = textArea.selectionEnd = start + 1
            },
            0
          )
        }
      }

      if (event.key === 'Backspace' && text.length === 0 && files.length > 0) {
        setFiles((prev) => prev.slice(0, -1))
        event.preventDefault()
      }
    },
    [
      inputFocus,
      autoTranslateWithSpace,
      isExpanded,
      text.length,
      files.length,
      textareaRef,
      spaceClickCount,
      translate,
      handleToggleExpanded,
      sendMessageShortcut,
      cannotSend,
      handleSendMessage,
      setText,
      setTimeoutTimer,
      setFiles
    ]
  )

  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value
      setText(newText)

      const isDeletion = newText.length < textRef.current.length

      const textArea = textareaRef.current?.resizableTextArea?.textArea
      const cursorPosition = textArea?.selectionStart ?? newText.length
      const lastSymbol = newText[cursorPosition - 1]
      const previousChar = newText[cursorPosition - 2]
      const isCursorAtTextStart = cursorPosition <= 1
      const hasValidTriggerBoundary = previousChar === ' ' || isCursorAtTextStart

      const openRootPanelAt = (position: number) => {
        triggers.emit(QuickPanelReservedSymbol.Root, {
          type: 'input',
          position,
          originalText: newText
        })
      }

      const openMentionPanelAt = (position: number) => {
        triggers.emit(QuickPanelReservedSymbol.MentionModels, {
          type: 'input',
          position,
          originalText: newText
        })
      }

      if (quickPanelTriggersEnabled && config.enableQuickPanel) {
        const hasRootMenuItems = triggers.getRootMenu().length > 0
        const textBeforeCursor = newText.slice(0, cursorPosition)
        const lastRootIndex = textBeforeCursor.lastIndexOf(QuickPanelReservedSymbol.Root)
        const lastMentionIndex = textBeforeCursor.lastIndexOf(QuickPanelReservedSymbol.MentionModels)
        const lastTriggerIndex = Math.max(lastRootIndex, lastMentionIndex)

        const allowResumeSearch =
          !quickPanel.isVisible &&
          (quickPanel.lastCloseAction === undefined || quickPanel.lastCloseAction === 'outsideclick')

        if (!quickPanel.isVisible && lastTriggerIndex !== -1 && cursorPosition > lastTriggerIndex) {
          const triggerChar = newText[lastTriggerIndex]
          const boundaryChar = newText[lastTriggerIndex - 1] ?? ''
          const hasBoundary = lastTriggerIndex === 0 || /\s/.test(boundaryChar)
          const searchSegment = newText.slice(lastTriggerIndex + 1, cursorPosition)
          const hasSearchContent = searchSegment.trim().length > 0

          if (hasBoundary && (!hasSearchContent || isDeletion || allowResumeSearch)) {
            if (triggerChar === QuickPanelReservedSymbol.Root && hasRootMenuItems) {
              openRootPanelAt(lastTriggerIndex)
            } else if (triggerChar === QuickPanelReservedSymbol.MentionModels) {
              openMentionPanelAt(lastTriggerIndex)
            }
          }
        }

        if (lastSymbol === QuickPanelReservedSymbol.Root && hasValidTriggerBoundary && hasRootMenuItems) {
          if (quickPanel.isVisible && quickPanel.symbol !== QuickPanelReservedSymbol.Root) {
            quickPanel.close('switch-symbol')
          }
          if (!quickPanel.isVisible || quickPanel.symbol !== QuickPanelReservedSymbol.Root) {
            openRootPanelAt(cursorPosition - 1)
          }
        }

        if (lastSymbol === QuickPanelReservedSymbol.MentionModels && hasValidTriggerBoundary) {
          if (quickPanel.isVisible && quickPanel.symbol !== QuickPanelReservedSymbol.MentionModels) {
            quickPanel.close('switch-symbol')
          }
          if (!quickPanel.isVisible || quickPanel.symbol !== QuickPanelReservedSymbol.MentionModels) {
            openMentionPanelAt(cursorPosition - 1)
          }
        }
      }

      if (quickPanel.isVisible && quickPanel.triggerInfo?.type === 'input') {
        const activeSymbol = quickPanel.symbol as QuickPanelReservedSymbol
        const triggerPosition = quickPanel.triggerInfo.position ?? -1
        const isTrackedSymbol =
          activeSymbol === QuickPanelReservedSymbol.Root || activeSymbol === QuickPanelReservedSymbol.MentionModels

        if (isTrackedSymbol && triggerPosition >= 0) {
          // Check if cursor is before the trigger position (user deleted the symbol)
          if (cursorPosition <= triggerPosition) {
            quickPanel.close('delete-symbol')
          } else {
            // Check if the trigger symbol still exists at the expected position
            const triggerChar = newText[triggerPosition]
            if (triggerChar !== activeSymbol) {
              quickPanel.close('delete-symbol')
            }
          }
        }
      }
    },
    [setText, textareaRef, quickPanelTriggersEnabled, config.enableQuickPanel, quickPanel, triggers]
  )

  const onTranslated = useCallback(
    (translatedText: string) => {
      setText(translatedText)
      setTimeoutTimer('onTranslated', () => resizeTextArea(), 0)
    },
    [resizeTextArea, setText, setTimeoutTimer]
  )

  const appendTxtContentToInput = useCallback(
    async (file: FileType, event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()

      try {
        const targetPath = file.path
        const content = await window.api.file.readExternal(targetPath, true)
        try {
          await navigator.clipboard.writeText(content)
        } catch (clipboardError) {
          logger.warn('Failed to copy txt attachment content to clipboard:', clipboardError as Error)
        }

        setText((prev) => {
          if (!prev) {
            return content
          }

          const needsSeparator = !prev.endsWith('\n')
          return needsSeparator ? `${prev}\n${content}` : prev + content
        })

        setFiles((prev) => prev.filter((currentFile) => currentFile.id !== file.id))

        setTimeoutTimer(
          'appendTxtAttachment',
          () => {
            const textArea = textareaRef.current?.resizableTextArea?.textArea
            if (textArea) {
              const end = textArea.value.length
              focusTextarea()
              textArea.setSelectionRange(end, end)
            }

            resizeTextArea(true)
          },
          0
        )
      } catch (error) {
        logger.warn('Failed to append txt attachment content:', error as Error)
        window.toast.error(t('chat.input.file_error'))
      }
    },
    [focusTextarea, resizeTextArea, setFiles, setText, setTimeoutTimer, t, textareaRef]
  )

  const handleFocus = useCallback(() => {
    setInputFocus(true)
    dispatch(setSearching(false))
    if (quickPanel.isVisible && quickPanel.triggerInfo?.type !== 'input') {
      quickPanel.close()
    }
    PasteService.setLastFocusedComponent('inputbar')
  }, [dispatch, quickPanel])

  const handleDragStart = useCallback(
    (event: React.MouseEvent) => {
      if (!config.enableDragDrop) {
        return
      }

      startDragY.current = event.clientY
      startHeight.current = textareaRef.current?.resizableTextArea?.textArea?.offsetHeight || 0

      const handleMouseMove = (e: MouseEvent) => {
        const deltaY = startDragY.current - e.clientY
        const newHeight = Math.max(40, Math.min(400, startHeight.current + deltaY))
        setTextareaHeight(newHeight)
      }

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [config.enableDragDrop, setTextareaHeight, textareaRef]
  )

  const onQuote = useCallback(
    (quoted: string) => {
      const formatted = formatQuotedText(quoted)
      setText((prevText) => {
        const next = prevText ? `${prevText}\n${formatted}\n` : `${formatted}\n`
        setTimeoutTimer('onQuote', () => resizeTextArea(), 0)
        return next
      })
      focusTextarea()
    },
    [focusTextarea, resizeTextArea, setText, setTimeoutTimer]
  )

  useEffect(() => {
    const quoteListener = window.electron?.ipcRenderer.on(IpcChannel.App_QuoteToMain, (_, selectedText: string) =>
      onQuote(selectedText)
    )
    return () => {
      quoteListener?.()
    }
  }, [onQuote])

  useEffect(() => {
    const timerId = requestAnimationFrame(() => resizeTextArea())
    return () => cancelAnimationFrame(timerId)
  }, [resizeTextArea])

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

  useEffect(() => {
    PasteService.init()

    PasteService.registerHandler('inputbar', handlePaste)

    return () => {
      PasteService.unregisterHandler('inputbar')
    }
  }, [handlePaste])

  useEffect(() => {
    return () => {
      if (spaceClickTimer.current) {
        clearTimeout(spaceClickTimer.current)
      }
    }
  }, [])

  const rightSectionExtras = useMemo(() => {
    const extras: React.ReactNode[] = []
    extras.push(<TranslateButton key="translate" text={text} onTranslated={onTranslated} isLoading={isTranslating} />)
    extras.push(<SendMessageButton sendMessage={handleSendMessage} disabled={cannotSend || isLoading || searching} />)

    if (isLoading) {
      extras.push(
        <Tooltip key="pause" placement="top" title={t('chat.input.pause')} mouseLeaveDelay={0} arrow>
          <ActionIconButton onClick={onPause} style={{ marginRight: -2 }}>
            <CirclePause size={20} color="var(--color-error)" />
          </ActionIconButton>
        </Tooltip>
      )
    }

    return <>{extras}</>
  }, [text, onTranslated, isTranslating, handleSendMessage, cannotSend, isLoading, searching, t, onPause])

  const quickPanelElement = config.enableQuickPanel ? <QuickPanelView setInputText={setText} /> : null

  return (
    <NarrowLayout style={{ width: '100%' }}>
      <Container
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={classNames('inputbar')}>
        {quickPanelElement}
        <InputBarContainer
          id="inputbar"
          className={classNames('inputbar-container', isDragging && 'file-dragging', isExpanded && 'expanded')}>
          <DragHandle onMouseDown={handleDragStart}>
            <HolderOutlined style={{ fontSize: 12 }} />
          </DragHandle>
          {files.length > 0 && (
            <AttachmentPreview files={files} setFiles={setFiles} onAttachmentContextMenu={appendTxtContentToInput} />
          )}
          {topContent}

          <Textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            onPaste={(e) => handlePaste(e.nativeEvent)}
            onFocus={handleFocus}
            onBlur={() => setInputFocus(false)}
            placeholder={isTranslating ? t('chat.input.translating') : placeholder}
            autoFocus
            variant="borderless"
            spellCheck={enableSpellCheck}
            rows={2}
            autoSize={textareaHeight ? false : { minRows: 2, maxRows: 20 }}
            styles={{ textarea: TextareaStyle }}
            style={{
              fontSize,
              height: textareaHeight,
              minHeight: '30px'
            }}
            disabled={isTranslating || searching}
            onClick={() => {
              searching && dispatch(setSearching(false))
              quickPanel.close()
            }}
          />

          <BottomBar>
            <LeftSection>{leftToolbar}</LeftSection>
            <RightSection>
              {rightToolbar}
              {rightSectionExtras}
            </RightSection>
          </BottomBar>
        </InputBarContainer>
      </Container>
    </NarrowLayout>
  )
}

// Styled Components
const DragHandle = styled.div`
  position: absolute;
  top: -3px;
  left: 0;
  right: 0;
  height: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: row-resize;
  color: var(--color-icon);
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 1;

  &:hover {
    opacity: 1;
  }

  .anticon {
    transform: rotate(90deg);
    font-size: 14px;
  }
`

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

const BottomBar = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 5px 8px;
  height: 40px;
  gap: 16px;
  position: relative;
  z-index: 2;
  flex-shrink: 0;
`

const LeftSection = styled.div`
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
`

const RightSection = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
`
