import { Textarea, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ActionIconButton } from '@renderer/components/Buttons'
import FileManager from '@renderer/services/FileManager'
import PasteService from '@renderer/services/PasteService'
import type { FileMetadata } from '@renderer/types'
import { FILE_TYPE } from '@renderer/types'
import { classNames } from '@renderer/utils'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getFilesFromDropEvent, isSendMessageKeyPressed } from '@renderer/utils/input'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import type { CherryMessagePart } from '@shared/data/types/message'
import { Languages, Loader2, Save, Send, X } from 'lucide-react'
import type { ComponentPropsWithoutRef, FC } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useMessageParts } from '../blocks'
import { useMessageListActions, useMessageListUi } from '../MessageListProvider'
import { defaultMessageEditorConfig, type MessageListItem } from '../types'
import { MessageAttachmentButton, MessageAttachmentPreview } from './MessageAttachmentPreview'

interface Props {
  message: MessageListItem
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
  const [isTranslating, setIsTranslating] = useState(false)
  const [isFileDragging, setIsFileDragging] = useState(false)
  const [isSelectingFiles, setIsSelectingFiles] = useState(false)
  const actions = useMessageListActions()
  const messageUi = useMessageListUi()
  const { pasteLongTextAsFile, pasteLongTextThreshold, fontSize, sendMessageShortcut, enableSpellCheck } =
    messageUi.editorConfig ?? defaultMessageEditorConfig
  const { t } = useTranslation()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isUserMessage = message.role === 'user'
  const editableText = useMemo(
    () =>
      editedParts
        .filter((part): part is Extract<CherryMessagePart, { type: 'text' }> => part.type === 'text')
        .map((part) => part.text)
        .join('\n\n'),
    [editedParts]
  )

  const editorCapabilities = messageUi.getMessageEditorCapabilities?.(message) ?? {
    canAddImageFile: false,
    canAddTextFile: true
  }
  const couldAddImageFile = editorCapabilities.canAddImageFile
  const couldAddTextFile = editorCapabilities.canAddTextFile

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
        const textLength = textareaRef.current.value.length
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(textLength, textLength)
      }
    }, 0)

    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (textareaRef.current) {
      const realTextarea = textareaRef.current
      realTextarea.scrollTo({ top: realTextarea.scrollHeight })
      const textLength = realTextarea.value.length
      realTextarea.focus()
      realTextarea.setSelectionRange(textLength, textLength)
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

  const onTranslated = useCallback((translatedText: string) => {
    setEditedParts((prev) => {
      const textIndex = prev.findIndex((part) => part.type === 'text')
      if (textIndex < 0) return prev
      return prev.map((part, index) =>
        index === textIndex && part.type === 'text' ? { ...part, text: translatedText } : part
      )
    })
  }, [])

  const handleTranslate = useCallback(async () => {
    if (!actions.translateEditorText || isTranslating || !editableText.trim()) return

    setIsTranslating(true)
    try {
      const translatedText = await actions.translateEditorText(editableText)
      if (translatedText) {
        onTranslated(translatedText)
      }
    } catch (error) {
      logger.error('Translation failed:', error as Error)
      actions.notifyError?.(formatErrorMessageWithPrefix(error, t('translate.error.failed')))
    } finally {
      setIsTranslating(false)
    }
  }, [actions.notifyError, actions.translateEditorText, editableText, isTranslating, onTranslated, t])

  const handlePartRemove = (index: number) => {
    setEditedParts((prev) => prev.filter((_, i) => i !== index))
  }

  const handleFileRemove = (fileId: string) => {
    setFiles((prevFiles) => prevFiles.filter((file) => file.id !== fileId))
  }

  const handleSelectFiles = useCallback(async () => {
    if (!actions.selectFiles || isSelectingFiles) return

    setIsSelectingFiles(true)
    try {
      const selectedFiles = await actions.selectFiles({ extensions })
      if (selectedFiles?.length) {
        setFiles((prevFiles) => [...prevFiles, ...selectedFiles])
      }
    } catch (error) {
      logger.error('Failed to select files:', error as Error)
    } finally {
      setIsSelectingFiles(false)
    }
  }, [actions.selectFiles, extensions, isSelectingFiles])

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
        actions.notifyInfo?.(t('chat.input.file_not_supported'))
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
    <EditorContainer
      className={classNames('message-editor', isFileDragging && 'file-dragging')}
      onDragEnter={() => setIsFileDragging(true)}
      onDragOver={(e) => {
        e.preventDefault()
        setIsFileDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setIsFileDragging(false)
        }
      }}
      onDrop={handleDrop}>
      <EditorInputArea>
        {editedParts
          .map((part, index) => ({ part, index }))
          .filter(({ part }) => part.type === 'text')
          .map(({ part, index }) => (
            <Textarea.Input
              className="editing-message"
              key={`part-${index}`}
              ref={textareaRef}
              value={(part as { text: string }).text}
              onChange={(e) => handleTextChange(index, e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              spellCheck={enableSpellCheck}
              onPaste={(e) => onPaste(e.nativeEvent)}
              onFocus={() => PasteService.setLastFocusedComponent('messageEditor')}
              onContextMenu={(e) => e.stopPropagation()}
              rows={1}
              style={{ fontSize }}
            />
          ))}
      </EditorInputArea>
      <MessageAttachmentPreview
        parts={editedParts}
        files={files}
        onRemovePart={handlePartRemove}
        onRemoveFile={handleFileRemove}
      />
      <ActionBar>
        <ActionBarLeft>
          {actions.translateEditorText && (
            <Tooltip
              content={
                messageUi.editorTranslationTargetLabel
                  ? t('chat.input.translate', { target_language: messageUi.editorTranslationTargetLabel })
                  : t('chat.translate')
              }>
              <ActionIconButton
                onClick={handleTranslate}
                icon={isTranslating ? <Loader2 size={18} className="animate-spin" /> : <Languages size={18} />}
                disabled={!editableText.trim() || isTranslating}
              />
            </Tooltip>
          )}
          {isUserMessage && actions.selectFiles && (
            <MessageAttachmentButton
              active={files.length > 0}
              couldAddImageFile={couldAddImageFile}
              disabled={isSelectingFiles}
              onClick={handleSelectFiles}
            />
          )}
        </ActionBarLeft>
        <ActionBarRight>
          <Tooltip content={t('common.cancel')}>
            <ActionIconButton onClick={onCancel} icon={<X size={16} />} />
          </Tooltip>
          <Tooltip content={t('common.save')}>
            <ActionIconButton onClick={handleSave} icon={<Save size={16} />} disabled={isProcessing} />
          </Tooltip>
          {message.role === 'user' && (
            <Tooltip content={t('chat.resend')}>
              <ActionIconButton onClick={handleResend} icon={<Send size={16} />} disabled={isProcessing} />
            </Tooltip>
          )}
        </ActionBarRight>
      </ActionBar>
    </EditorContainer>
  )
}

const EditorContainer = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={[
      '[&_.editing-message]:resize-none! relative my-3 ml-10 flex w-[calc(100%-2.5rem)] flex-col overflow-hidden rounded-[14px] border border-border bg-background shadow-sm transition-all duration-200 ease-in-out focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15 [&.file-dragging]:border-[#2ecc71] [&.file-dragging]:border-dashed [&.file-dragging]:bg-[#2ecc71]/5 [&_.editing-message]:box-border [&_.editing-message]:max-h-[480px] [&_.editing-message]:min-h-[72px] [&_.editing-message]:w-full [&_.editing-message]:flex-1 [&_.editing-message]:overflow-auto [&_.editing-message]:rounded-none [&_.editing-message]:border-0 [&_.editing-message]:bg-transparent [&_.editing-message]:px-4 [&_.editing-message]:py-3.5 [&_.editing-message]:font-[Ubuntu] [&_.editing-message]:leading-[1.5] [&_.editing-message]:shadow-none [&_.editing-message]:outline-none [&_.editing-message]:ring-0',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const EditorInputArea = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['flex min-h-[72px] flex-col', className].filter(Boolean).join(' ')} {...props} />
)

const ActionBar = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={['flex min-h-11 items-center justify-between gap-2 border-border/70 border-t px-2.5', className]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const ActionBarLeft = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['flex min-w-0 items-center gap-1', className].filter(Boolean).join(' ')} {...props} />
)

const ActionBarRight = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['ml-auto flex items-center gap-1', className].filter(Boolean).join(' ')} {...props} />
)

export default memo(MessageEditor)
