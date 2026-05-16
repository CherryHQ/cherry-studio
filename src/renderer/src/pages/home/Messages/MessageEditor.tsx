import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { ActionIconButton } from '@renderer/components/Buttons'
import CustomTag from '@renderer/components/Tags/CustomTag'
import TranslateButton from '@renderer/components/TranslateButton'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import type { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import FileManager from '@renderer/services/FileManager'
import PasteService from '@renderer/services/PasteService'
import type { FileMetadata } from '@renderer/types'
import { FILE_TYPE } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { classNames } from '@renderer/utils'
import { getFilesFromDropEvent, isSendMessageKeyPressed } from '@renderer/utils/input'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import type { CherryMessagePart } from '@shared/data/types/message'
import { isVisionModel } from '@shared/utils/model'
import { Space } from 'antd'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import TextArea from 'antd/es/input/TextArea'
import { Save, Send, X } from 'lucide-react'
import type { FC } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { FileNameRender, getFileIcon } from '../Inputbar/AttachmentPreview'
import AttachmentButton from '../Inputbar/tools/components/AttachmentButton'
import { useMessageParts } from './Blocks'

interface Props {
  message: Message
  onSave: (parts: CherryMessagePart[]) => void
  onResend: (parts: CherryMessagePart[]) => void
  onCancel: () => void
}

const logger = loggerService.withContext('MessageEditor')

const MessageEditor: FC<Props> = ({ message, onSave, onResend, onCancel }) => {
  const messageParts = useMessageParts(message.id)
  const [editedParts, setEditedParts] = useState<CherryMessagePart[]>(messageParts)
  const [files, setFiles] = useState<FileMetadata[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isFileDragging, setIsFileDragging] = useState(false)
  // v1 message
  const { model } = useAssistant(message.assistantId)
  const { pasteLongTextAsFile } = useSettings()

  const [pasteLongTextThreshold] = usePreference('chat.input.paste_long_text_threshold')
  const [fontSize] = usePreference('chat.message.font_size')
  const [sendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const { t } = useTranslation()
  const textareaRef = useRef<TextAreaRef>(null)
  const isUserMessage = message.role === 'user'

  const noopQuickPanel = useMemo<ToolQuickPanelApi>(
    () => ({
      registerRootMenu: () => () => {},
      registerTrigger: () => () => {}
    }),
    []
  )

  const couldAddImageFile = useMemo(() => (model ? isVisionModel(model) : false), [model])
  const couldAddTextFile = useMemo(() => true, [])

  const extensions = useMemo(() => {
    if (couldAddImageFile && couldAddTextFile) {
      return [...imageExts, ...documentExts, ...textExts]
    } else if (couldAddImageFile) {
      return [...imageExts]
    } else if (couldAddTextFile) {
      return [...documentExts, ...textExts]
    } else {
      return []
    }
  }, [couldAddImageFile, couldAddTextFile])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus({ cursor: 'end' })
      }
    }, 0)

    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (textareaRef.current) {
      const realTextarea = textareaRef.current.resizableTextArea?.textArea
      if (realTextarea) {
        realTextarea.scrollTo({ top: realTextarea.scrollHeight })
      }
      textareaRef.current.focus({ cursor: 'end' })
    }
  }, [])

  const onPaste = useCallback(
    async (event: ClipboardEvent) => {
      return await PasteService.handlePaste(
        event,
        extensions,
        setFiles,
        undefined,
        pasteLongTextAsFile,
        pasteLongTextThreshold,
        undefined,
        undefined,
        t
      )
    },
    [extensions, pasteLongTextThreshold, t, pasteLongTextAsFile]
  )

  useEffect(() => {
    PasteService.registerHandler('messageEditor', onPaste)
    PasteService.setLastFocusedComponent('messageEditor')

    return () => {
      PasteService.unregisterHandler('messageEditor')
    }
  }, [onPaste])

  const handleTextChange = (index: number, text: string) => {
    setEditedParts((prev) =>
      prev.map((part, i) => {
        if (i !== index || part.type !== 'text') return part
        return { ...part, text }
      })
    )
  }

  const onTranslated = (translatedText: string) => {
    const textIndex = editedParts.findIndex((p) => p.type === 'text')
    if (textIndex >= 0) {
      handleTextChange(textIndex, translatedText)
    }
  }

  const handlePartRemove = (index: number) => {
    setEditedParts((prev) => prev.filter((_, i) => i !== index))
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsFileDragging(false)

    const droppedFiles = await getFilesFromDropEvent(e).catch((err) => {
      logger.error('handleDrop error:', err)
      return null
    })
    if (droppedFiles) {
      let supportedFiles = 0
      droppedFiles.forEach((file) => {
        if (extensions.includes(file.ext.toLowerCase())) {
          setFiles((prevFiles) => [...prevFiles, file])
          supportedFiles++
        }
      })

      if (droppedFiles.length > 0 && supportedFiles === 0) {
        window.toast.info(t('chat.input.file_not_supported'))
      }
    }
  }

  const buildFinalParts = async (): Promise<CherryMessagePart[]> => {
    const finalParts = [...editedParts]
    if (files.length > 0) {
      const uploadedFiles = await FileManager.uploadFiles(files)
      for (const file of uploadedFiles) {
        const isImage = file.type === FILE_TYPE.IMAGE
        finalParts.push({
          type: 'file',
          mediaType: isImage ? `image/${file.ext.replace('.', '')}` : 'application/octet-stream',
          url: `file://${file.path}`,
          filename: file.origin_name || file.name
        } as CherryMessagePart)
      }
    }
    return finalParts
  }

  const handleSave = async () => {
    if (isProcessing) return
    setIsProcessing(true)
    try {
      const finalParts = await buildFinalParts()
      onSave(finalParts)
    } catch (error) {
      logger.error('Failed to save:', error as Error)
      setIsProcessing(false)
    }
  }

  const handleResend = async () => {
    if (isProcessing) return
    setIsProcessing(true)
    try {
      const finalParts = await buildFinalParts()
      onResend(finalParts)
    } catch (error) {
      logger.error('Failed to resend:', error as Error)
      setIsProcessing(false)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (message.role !== 'user') {
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }

    const isEnterPressed = event.key === 'Enter' && !event.nativeEvent.isComposing
    if (isEnterPressed) {
      if (isSendMessageKeyPressed(event, sendMessageShortcut)) {
        void handleResend()
        return event.preventDefault()
      }
    }
  }

  return (
    <>
      <EditorContainer
        className="message-editor"
        direction="vertical"
        size="small"
        style={{ display: 'flex' }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}>
        {editedParts
          .map((part, index) => ({ part, index }))
          .filter(({ part }) => part.type === 'text')
          .map(({ part, index }) => (
            <TextArea
              className={classNames('editing-message', isFileDragging && 'file-dragging')}
              key={`part-${index}`}
              ref={textareaRef}
              variant="borderless"
              value={(part as { text: string }).text}
              onChange={(e) => handleTextChange(index, e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              spellCheck={enableSpellCheck}
              onPaste={(e) => onPaste(e.nativeEvent)}
              onFocus={() => PasteService.setLastFocusedComponent('messageEditor')}
              onContextMenu={(e) => e.stopPropagation()}
              autoSize={{ minRows: 1, maxRows: 15 }}
              style={{ fontSize }}>
              <TranslateButton onTranslated={onTranslated} />
            </TextArea>
          ))}
        {(editedParts.some((part) => part.type === 'file') || files.length > 0) && (
          <FileBlocksContainer>
            {editedParts
              .map((part, index) => ({ part, index }))
              .filter(({ part }) => part.type === 'file')
              .map(({ part, index }) => {
                const filePart = part as { filename?: string; url?: string }
                const ext = filePart.filename?.split('.').pop() || ''
                return (
                  <CustomTag
                    key={`file-part-${index}`}
                    icon={getFileIcon(ext)}
                    color="#37a5aa"
                    closable
                    onClose={() => handlePartRemove(index)}>
                    {filePart.filename || filePart.url || 'file'}
                  </CustomTag>
                )
              })}

            {files.map((file) => (
              <CustomTag
                key={file.id}
                icon={getFileIcon(file.ext)}
                color="#37a5aa"
                closable
                onClose={() => setFiles((prevFiles) => prevFiles.filter((f) => f.id !== file.id))}>
                <FileNameRender file={file} />
              </CustomTag>
            ))}
          </FileBlocksContainer>
        )}
      </EditorContainer>
      <ActionBar>
        <ActionBarLeft>
          {isUserMessage && (
            <AttachmentButton
              quickPanel={noopQuickPanel}
              files={files}
              setFiles={setFiles}
              couldAddImageFile={couldAddImageFile}
              extensions={extensions}
            />
          )}
        </ActionBarLeft>
        <ActionBarMiddle />
        <ActionBarRight>
          <Tooltip content={t('common.cancel')}>
            <ActionIconButton onClick={onCancel} icon={<X size={16} />} />
          </Tooltip>
          <Tooltip content={t('common.save')}>
            <ActionIconButton onClick={handleSave} icon={<Save size={16} />} />
          </Tooltip>
          {message.role === 'user' && (
            <Tooltip content={t('chat.resend')}>
              <ActionIconButton onClick={handleResend} icon={<Send size={16} />} />
            </Tooltip>
          )}
        </ActionBarRight>
      </ActionBar>
    </>
  )
}

const EditorContainer = styled(Space)`
  margin: 15px 0 5px 0;
  transition: all 0.2s ease;
  width: 100%;

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

  .editing-message {
    background-color: var(--color-background-opacity);
    border: 0.5px solid var(--color-border);
    border-radius: 15px;
    padding: 1em;
    flex: 1;
    font-family: Ubuntu;
    resize: none !important;
    overflow: auto;
    width: 100%;
    box-sizing: border-box;
    &.ant-input {
      line-height: 1.4;
    }
  }
`

const FileBlocksContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0;
  margin: 8px 0;
  background: transparent;
  border-radius: 4px;
`

const ActionBar = styled.div`
  display: flex;
  padding: 0 8px;
  justify-content: space-between;
  margin-top: 8px;
`

const ActionBarLeft = styled.div`
  display: flex;
  align-items: center;
`

const ActionBarMiddle = styled.div`
  flex: 1;
`

const ActionBarRight = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

export default memo(MessageEditor)
