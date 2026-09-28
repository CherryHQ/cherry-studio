import { useCallback, useMemo } from 'react'

import type { MessageListActions } from '@renderer/components/chat/messages/types'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { exportDocument } from '@renderer/services/documentExport'
import { chooseImageExportMode } from '@renderer/services/imageExportModeChooser'
import type { MessageExportView } from '@renderer/types/messageExport'

type MessageExportActions = Pick<
  MessageListActions,
  | 'saveTextFile'
  | 'saveImage'
  | 'saveToKnowledge'
  | 'exportMessageAsMarkdown'
  | 'exportToNotes'
  | 'exportToWord'
  | 'exportToDocument'
  | 'exportToNotion'
  | 'exportToYuque'
  | 'exportToObsidian'
  | 'exportToJoplin'
  | 'exportToSiyuan'
>

interface MessageExportActionParams {
  topicName?: string
  workspacePath?: string
}

export function useMessageExportActions({ topicName, workspacePath }: MessageExportActionParams): MessageExportActions {
  const { notesPath } = useNotesSettings()

  const saveTextFile = useCallback((fileName: string, content: string) => {
    return window.api.file.save(fileName, content)
  }, [])

  const saveImage = useCallback((fileName: string, dataUrl: string) => {
    return window.api.file.saveImage(fileName, dataUrl)
  }, [])

  const exportToWord = useCallback(
    (markdown: string, title: string) =>
      exportDocument({ markdown, defaultName: title, format: 'docx', assetRoot: workspacePath }),
    [workspacePath]
  )

  const exportToDocument = useCallback<NonNullable<MessageListActions['exportToDocument']>>(
    (markdown, title, format) => exportDocument({ markdown, defaultName: title, format, assetRoot: workspacePath }),
    [workspacePath]
  )

  const saveToKnowledge = useCallback(async (message: MessageExportView) => {
    const { default: SaveToKnowledgePopup } = await import('@renderer/components/SaveToKnowledgePopup')
    void SaveToKnowledgePopup.showForMessage(message)
  }, [])

  const exportMessageAsMarkdown = useCallback(async (message: MessageExportView, includeReasoning?: boolean) => {
    const { exportMessageAsMarkdown: exportMessageAsMarkdownFile } = await import('@renderer/services/ExportService')
    return exportMessageAsMarkdownFile(message, includeReasoning, undefined, chooseImageExportMode)
  }, [])

  const exportToNotes = useCallback(
    async (message: MessageExportView) => {
      const { exportMessageToNotes, getMessageTitle, messageToMarkdown } =
        await import('@renderer/services/ExportService')
      const title = await getMessageTitle(message)
      const markdown = await messageToMarkdown(message)
      return exportMessageToNotes(title, markdown, notesPath)
    },
    [notesPath]
  )

  const exportToNotion = useCallback(async (message: MessageExportView) => {
    const { exportMessageToNotion, getMessageTitle, messageToMarkdown } =
      await import('@renderer/services/ExportService')
    const title = await getMessageTitle(message)
    const markdown = await messageToMarkdown(message)
    await exportMessageToNotion(title, markdown, message)
  }, [])

  const exportToYuque = useCallback(async (message: MessageExportView) => {
    const { exportMarkdownToYuque, getMessageTitle, messageToMarkdown } =
      await import('@renderer/services/ExportService')
    const title = await getMessageTitle(message)
    const markdown = await messageToMarkdown(message)
    await exportMarkdownToYuque(title, markdown)
  }, [])

  const exportToObsidian = useCallback(
    async (message: MessageExportView) => {
      const title = topicName?.replace(/\\/g, '_') || 'Untitled'
      const { default: ObsidianExportPopup } = await import('@renderer/components/ObsidianExportPopup')
      await ObsidianExportPopup.show({ title, message, processingMethod: '1' })
    },
    [topicName]
  )

  const exportToJoplin = useCallback(async (message: MessageExportView) => {
    const { exportMarkdownToJoplin, getMessageTitle } = await import('@renderer/services/ExportService')
    const title = await getMessageTitle(message)
    await exportMarkdownToJoplin(title, message)
  }, [])

  const exportToSiyuan = useCallback(async (message: MessageExportView) => {
    const { exportMarkdownToSiyuan, getMessageTitle, messageToMarkdown } =
      await import('@renderer/services/ExportService')
    const title = await getMessageTitle(message)
    const markdown = await messageToMarkdown(message)
    return exportMarkdownToSiyuan(title, markdown)
  }, [])

  return useMemo(
    () => ({
      saveTextFile,
      saveImage,
      saveToKnowledge,
      exportMessageAsMarkdown,
      exportToNotes,
      exportToWord,
      exportToDocument,
      exportToNotion,
      exportToYuque,
      exportToObsidian,
      exportToJoplin,
      exportToSiyuan
    }),
    [
      exportMessageAsMarkdown,
      exportToJoplin,
      exportToNotes,
      exportToNotion,
      exportToObsidian,
      exportToSiyuan,
      exportToWord,
      exportToDocument,
      exportToYuque,
      saveImage,
      saveTextFile,
      saveToKnowledge
    ]
  )
}
