import type { MessageListActions } from '@renderer/components/chat/messages/types'
import FileManager from '@renderer/services/FileManager'
import PasteService from '@renderer/services/PasteService'
import { FILE_TYPE, type FileMetadata } from '@renderer/types'
import { getFilesFromDropEvent } from '@renderer/utils/input'
import type { CherryMessagePart } from '@shared/data/types/message'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type MessageEditorActions = Pick<
  MessageListActions,
  | 'uploadEditorFiles'
  | 'handleEditorPaste'
  | 'bindEditorPasteHandler'
  | 'focusEditorPasteTarget'
  | 'getDroppedEditorFiles'
>

export function useMessageEditorCapabilities(): MessageEditorActions {
  const { t } = useTranslation()

  const uploadEditorFiles = useCallback<NonNullable<MessageListActions['uploadEditorFiles']>>(
    async (files: FileMetadata[]) => {
      const uploadedFiles = await FileManager.uploadFiles(files)
      return uploadedFiles.map((file) => {
        const isImage = file.type === FILE_TYPE.IMAGE
        return {
          type: 'file',
          mediaType: isImage ? `image/${file.ext.replace('.', '')}` : 'application/octet-stream',
          url: `file://${file.path}`,
          filename: file.origin_name || file.name
        } as CherryMessagePart
      })
    },
    []
  )

  const handleEditorPaste = useCallback<NonNullable<MessageListActions['handleEditorPaste']>>(
    async ({ event, extensions, addFiles, pasteLongTextAsFile, pasteLongTextThreshold }) => {
      let pastedFiles: FileMetadata[] = []

      const isSameFile = (left: FileMetadata, right: FileMetadata) =>
        left.id ? left.id === right.id : left.path === right.path && left.name === right.name && left.ext === right.ext

      return PasteService.handlePaste(
        event,
        extensions,
        (updater) => {
          const nextFiles = updater(pastedFiles)
          const newFiles = nextFiles.filter((file) => !pastedFiles.some((pastedFile) => isSameFile(pastedFile, file)))
          if (newFiles.length) {
            addFiles(newFiles)
          }

          pastedFiles = nextFiles
        },
        undefined,
        pasteLongTextAsFile,
        pasteLongTextThreshold,
        undefined,
        undefined,
        t
      )
    },
    [t]
  )

  const bindEditorPasteHandler = useCallback<NonNullable<MessageListActions['bindEditorPasteHandler']>>((handler) => {
    PasteService.registerHandler('messageEditor', handler)
    PasteService.setLastFocusedComponent('messageEditor')

    return () => {
      PasteService.unregisterHandler('messageEditor')
    }
  }, [])

  const focusEditorPasteTarget = useCallback<NonNullable<MessageListActions['focusEditorPasteTarget']>>(() => {
    PasteService.setLastFocusedComponent('messageEditor')
  }, [])

  const getDroppedEditorFiles = useCallback<NonNullable<MessageListActions['getDroppedEditorFiles']>>((event) => {
    return getFilesFromDropEvent(event)
  }, [])

  return useMemo(
    () => ({
      uploadEditorFiles,
      handleEditorPaste,
      bindEditorPasteHandler,
      focusEditorPasteTarget,
      getDroppedEditorFiles
    }),
    [bindEditorPasteHandler, focusEditorPasteTarget, getDroppedEditorFiles, handleEditorPaste, uploadEditorFiles]
  )
}
