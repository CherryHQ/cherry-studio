import { Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import {
  createComposerDocumentContent,
  createComposerMessageSnapshot,
  serializeComposerDocument
} from '@renderer/components/chat/composer/composerDraft'
import { createComposerEditorPreset } from '@renderer/components/chat/composer/composerPreset'
import type { ComposerSerializedDraft } from '@renderer/components/chat/composer/tokens'
import { useRichTextEditorKernel } from '@renderer/components/RichEditor/useRichTextEditorKernel'
import type { FileMetadata } from '@renderer/types'
import { classNames } from '@renderer/utils'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import type { SendMessageShortcut } from '@shared/data/preference/preferenceTypes'
import type { CherryMessagePart } from '@shared/data/types/message'
import { readCherryMeta, withCherryMeta, withoutCherryMeta } from '@shared/data/types/uiParts'
import { EditorContent } from '@tiptap/react'
import { Languages, Loader2, Save, Send, X } from 'lucide-react'
import type { ComponentPropsWithoutRef, FC } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useMessageParts } from '../blocks'
import { useMessageListActions, useMessageListUi } from '../MessageListProvider'
import { defaultMessageEditorConfig, type MessageListItem } from '../types'
import { MessageActionButton } from './MessageActionButton'
import { MessageAttachmentButton, MessageAttachmentPreview } from './MessageAttachmentPreview'

interface Props {
  message: MessageListItem
  onSave: (parts: CherryMessagePart[]) => void | Promise<void>
  onResend: (parts: CherryMessagePart[]) => void | Promise<void>
  onCancel: () => void
}

const logger = loggerService.withContext('MessageEditor')
type TextMessagePart = Extract<CherryMessagePart, { type: 'text' }>

function updateTextPartFromDraft(part: TextMessagePart, draft: ComposerSerializedDraft): TextMessagePart {
  return updateTextPartContent(part, draft.text, createComposerMessageSnapshot(draft))
}

function updateTextPartContent(
  part: TextMessagePart,
  text: string,
  composer?: ReturnType<typeof createComposerMessageSnapshot>
): TextMessagePart {
  const nextPart = { ...part, text } as TextMessagePart
  return composer ? withCherryMeta(nextPart, { composer }) : withoutCherryMeta(nextPart, 'composer')
}

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
  const handleEditorPasteAction = actions.handleEditorPaste
  const bindEditorPasteHandler = actions.bindEditorPasteHandler
  const focusEditorPasteTarget = actions.focusEditorPasteTarget
  const getDroppedEditorFiles = actions.getDroppedEditorFiles
  const { fontSize, sendMessageShortcut, enableSpellCheck } = messageUi.editorConfig ?? defaultMessageEditorConfig
  const { t } = useTranslation()
  const isUserMessage = message.role === 'user'
  const firstTextPartIndex = useMemo(() => editedParts.findIndex((part) => part.type === 'text'), [editedParts])
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
    canAddTextFile: true,
    canForkAndResend: true
  }
  const canUploadEditorFiles = !!actions.uploadEditorFiles
  const couldAddImageFile = canUploadEditorFiles && editorCapabilities.canAddImageFile
  const couldAddTextFile = canUploadEditorFiles && editorCapabilities.canAddTextFile
  const canForkAndResend =
    isUserMessage && !!actions.forkAndResendMessage && (editorCapabilities.canForkAndResend ?? true)

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

  const addFiles = useCallback((nextFiles: FileMetadata[]) => {
    if (nextFiles.length) {
      setFiles((prevFiles) => [...prevFiles, ...nextFiles])
    }
  }, [])

  const onPaste = useCallback(
    async (event: ClipboardEvent) => {
      if (!handleEditorPasteAction) return false

      return handleEditorPasteAction({
        event,
        extensions,
        addFiles
      })
    },
    [addFiles, extensions, handleEditorPasteAction]
  )

  useEffect(() => {
    return bindEditorPasteHandler?.(onPaste)
  }, [bindEditorPasteHandler, onPaste])

  const handleTextPartDraftChange = useCallback((index: number, draft: ComposerSerializedDraft) => {
    setEditedParts((prev) =>
      prev.map((part, i) => {
        if (i !== index || part.type !== 'text') return part
        return updateTextPartFromDraft(part, draft)
      })
    )
  }, [])

  const onTranslated = useCallback((translatedText: string) => {
    setEditedParts((prev) => {
      const textIndex = prev.findIndex((part) => part.type === 'text')
      if (textIndex < 0) return prev
      return prev.map((part, index) =>
        index === textIndex && part.type === 'text' ? updateTextPartContent(part, translatedText, undefined) : part
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
  }, [actions, editableText, isTranslating, onTranslated, t])

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
      actions.notifyError?.(formatErrorMessageWithPrefix(error, t('common.error')))
    } finally {
      setIsSelectingFiles(false)
    }
  }, [actions, extensions, isSelectingFiles, t])

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsFileDragging(false)

    if (!getDroppedEditorFiles) return

    try {
      const droppedFiles = await getDroppedEditorFiles(e)
      if (droppedFiles) {
        const supportedFiles = droppedFiles.filter((file) => extensions.includes(file.ext.toLowerCase()))
        addFiles(supportedFiles)

        if (droppedFiles.length > 0 && supportedFiles.length === 0) {
          actions.notifyInfo?.(t('chat.input.file_not_supported'))
        }
      }
    } catch (error) {
      logger.error('handleDrop error:', error as Error)
      actions.notifyError?.(formatErrorMessageWithPrefix(error, t('common.error')))
    }
  }

  const buildFinalParts = useCallback(async (): Promise<CherryMessagePart[]> => {
    const finalParts = [...editedParts]
    if (files.length > 0) {
      const uploadedParts = await actions.uploadEditorFiles?.(files)
      if (uploadedParts?.length) finalParts.push(...uploadedParts)
    }
    return finalParts
  }, [actions, editedParts, files])

  const handleSave = useCallback(async () => {
    if (isProcessing) return
    setIsProcessing(true)
    try {
      const finalParts = await buildFinalParts()
      await onSave(finalParts)
    } catch (error) {
      logger.error('Failed to save:', error as Error)
      actions.notifyError?.(formatErrorMessageWithPrefix(error, t('common.save_failed')))
    } finally {
      setIsProcessing(false)
    }
  }, [actions, buildFinalParts, isProcessing, onSave, t])

  const handleResend = useCallback(async () => {
    if (isProcessing || !canForkAndResend) return
    setIsProcessing(true)
    try {
      const finalParts = await buildFinalParts()
      await onResend(finalParts)
    } catch (error) {
      logger.error('Failed to resend:', error as Error)
      actions.notifyError?.(formatErrorMessageWithPrefix(error, t('chat.resend')))
    } finally {
      setIsProcessing(false)
    }
  }, [actions, buildFinalParts, canForkAndResend, isProcessing, onResend, t])

  const handleEditorKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
        return true
      }

      if (!canForkAndResend) {
        return false
      }

      const isEnterPressed = event.key === 'Enter' && !event.isComposing
      if (isEnterPressed) {
        if (isEditorSendShortcutPressed(event, sendMessageShortcut)) {
          void handleResend()
          event.preventDefault()
          return true
        }
      }
      return false
    },
    [canForkAndResend, handleResend, onCancel, sendMessageShortcut]
  )

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
          .filter((entry): entry is { part: TextMessagePart; index: number } => entry.part.type === 'text')
          .map(({ part, index }) => (
            <MessageTextPartEditor
              key={`part-${index}`}
              part={part}
              fontSize={fontSize}
              enableSpellCheck={enableSpellCheck}
              autoFocus={index === firstTextPartIndex}
              onDraftChange={(draft) => handleTextPartDraftChange(index, draft)}
              onKeyDown={handleEditorKeyDown}
              onPaste={onPaste}
              onFocus={() => focusEditorPasteTarget?.()}
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
              <MessageActionButton
                className="message-editor-action-button"
                onClick={handleTranslate}
                disabled={!editableText.trim() || isTranslating}>
                {isTranslating ? <Loader2 size={18} className="animate-spin" /> : <Languages size={18} />}
              </MessageActionButton>
            </Tooltip>
          )}
          {isUserMessage && actions.selectFiles && (couldAddImageFile || couldAddTextFile) && (
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
            <MessageActionButton className="message-editor-action-button" onClick={onCancel}>
              <X size={16} />
            </MessageActionButton>
          </Tooltip>
          <Tooltip content={t('common.save')}>
            <MessageActionButton className="message-editor-action-button" onClick={handleSave} disabled={isProcessing}>
              <Save size={16} />
            </MessageActionButton>
          </Tooltip>
          {canForkAndResend && (
            <Tooltip content={t('chat.resend')}>
              <MessageActionButton
                className="message-editor-action-button"
                onClick={handleResend}
                disabled={isProcessing}>
                <Send size={16} />
              </MessageActionButton>
            </Tooltip>
          )}
        </ActionBarRight>
      </ActionBar>
    </EditorContainer>
  )
}

interface MessageTextPartEditorProps {
  part: TextMessagePart
  fontSize: number
  enableSpellCheck: boolean
  autoFocus: boolean
  onDraftChange: (draft: ComposerSerializedDraft) => void
  onKeyDown: (event: KeyboardEvent) => boolean
  onPaste: (event: ClipboardEvent) => void | Promise<boolean>
  onFocus: () => void
}

const MessageTextPartEditor = memo(function MessageTextPartEditor({
  part,
  fontSize,
  enableSpellCheck,
  autoFocus,
  onDraftChange,
  onKeyDown,
  onPaste,
  onFocus
}: MessageTextPartEditorProps) {
  const localTextEchoRef = useRef<string | null>(null)
  const [initialContent] = useState(() => createComposerDocumentContent(part.text, readCherryMeta(part)?.composer))
  const editorExtensions = useMemo(() => createComposerEditorPreset({ enableUndoRedo: false }), [])
  const editor = useRichTextEditorKernel({
    extensions: editorExtensions,
    content: initialContent,
    enableSpellCheck,
    editorProps: {
      attributes: {
        class: 'composer-tiptap editing-message',
        role: 'textbox',
        'aria-multiline': 'true',
        style: [
          '--composer-editor-padding: 14px 16px',
          '--composer-editor-min-height: 72px',
          `--composer-editor-font-size: ${fontSize}px`,
          '--composer-editor-line-height: 1.5'
        ].join('; ')
      },
      handleKeyDown: (_view, event) => onKeyDown(event),
      handleDOMEvents: {
        focus: () => {
          onFocus()
          return false
        },
        contextmenu: (_view, event) => {
          event.stopPropagation()
          return false
        }
      }
    },
    handlePaste: (_view, event) => {
      void onPaste(event)
      return false
    },
    onUpdate: ({ editor: updatedEditor }) => {
      const draft = serializeComposerDocument(updatedEditor)
      localTextEchoRef.current = draft.text
      onDraftChange(draft)
    },
    shouldRerenderOnTransaction: true
  })

  useEffect(() => {
    if (!autoFocus || !editor || editor.isDestroyed) return

    const timer = window.setTimeout(() => {
      if (editor.isDestroyed) return
      try {
        editor.commands.focus('end', { scrollIntoView: false })
      } catch {
        // The Tiptap view can still be attaching in tests and during fast unmounts.
      }
    }, 0)

    return () => window.clearTimeout(timer)
  }, [autoFocus, editor])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return

    const currentText = serializeComposerDocument(editor).text
    if (currentText === part.text) {
      localTextEchoRef.current = null
      return
    }
    if (localTextEchoRef.current === part.text) {
      localTextEchoRef.current = null
      return
    }

    localTextEchoRef.current = null
    editor.commands.setContent(createComposerDocumentContent(part.text, readCherryMeta(part)?.composer), {
      emitUpdate: false
    })
  }, [editor, part])

  return <EditorContent editor={editor} />
})

const EditorContainer = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={[
      '[&_.editing-message]:resize-none! relative my-3 ml-0 flex w-full flex-col overflow-hidden rounded-[14px] border border-border bg-background shadow-sm transition-all duration-200 ease-in-out focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15 [&.file-dragging]:border-[#2ecc71] [&.file-dragging]:border-dashed [&.file-dragging]:bg-[#2ecc71]/5 [&_.editing-message]:box-border [&_.editing-message]:max-h-[480px] [&_.editing-message]:min-h-[72px] [&_.editing-message]:w-full [&_.editing-message]:flex-1 [&_.editing-message]:overflow-auto [&_.editing-message]:rounded-none [&_.editing-message]:border-0 [&_.editing-message]:bg-transparent [&_.editing-message]:px-4 [&_.editing-message]:py-3.5 [&_.editing-message]:font-[Ubuntu] [&_.editing-message]:leading-[1.5] [&_.editing-message]:shadow-none [&_.editing-message]:outline-none [&_.editing-message]:ring-0 [&_.editing-message_p]:m-0',
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

function isEditorSendShortcutPressed(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  shortcut: SendMessageShortcut
): boolean {
  switch (shortcut) {
    case 'Enter':
      return !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
    case 'Ctrl+Enter':
      return event.ctrlKey && !event.shiftKey && !event.metaKey && !event.altKey
    case 'Command+Enter':
      return event.metaKey && !event.shiftKey && !event.ctrlKey && !event.altKey
    case 'Alt+Enter':
      return event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey
    case 'Shift+Enter':
      return event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
  }

  return false
}

export default memo(MessageEditor)
