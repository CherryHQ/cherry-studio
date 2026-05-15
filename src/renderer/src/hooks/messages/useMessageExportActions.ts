import type { MessageListActions } from '@renderer/components/chat/messages/types'
import ObsidianExportPopup from '@renderer/components/Popups/ObsidianExportPopup'
import SaveToKnowledgePopup from '@renderer/components/Popups/SaveToKnowledgePopup'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { getMessageTitle } from '@renderer/services/MessagesService'
import type { MessageExportView } from '@renderer/types/messageExport'
import {
  exportMarkdownToJoplin,
  exportMarkdownToSiyuan,
  exportMarkdownToYuque,
  exportMessageAsMarkdown as exportMessageAsMarkdownFile,
  exportMessageToNotes,
  exportMessageToNotion,
  messageToMarkdown
} from '@renderer/utils/export'
import { useCallback, useMemo } from 'react'

type MessageExportActions = Pick<
  MessageListActions,
  | 'saveTextFile'
  | 'saveImage'
  | 'saveToKnowledge'
  | 'exportMessageAsMarkdown'
  | 'exportToNotes'
  | 'exportToWord'
  | 'exportToNotion'
  | 'exportToYuque'
  | 'exportToObsidian'
  | 'exportToJoplin'
  | 'exportToSiyuan'
>

interface MessageExportActionParams {
  topicName?: string
}

export function useMessageExportActions({ topicName }: MessageExportActionParams): MessageExportActions {
  const { notesPath } = useNotesSettings()

  const saveTextFile = useCallback((fileName: string, content: string) => {
    return window.api.file.save(fileName, content)
  }, [])

  const saveImage = useCallback((fileName: string, dataUrl: string) => {
    return window.api.file.saveImage(fileName, dataUrl)
  }, [])

  const exportToWord = useCallback((markdown: string, title: string) => {
    return window.api.export.toWord(markdown, title)
  }, [])

  const saveToKnowledge = useCallback((message: MessageExportView) => {
    SaveToKnowledgePopup.showForMessage(message)
  }, [])

  const exportMessageAsMarkdown = useCallback((message: MessageExportView, includeReasoning?: boolean) => {
    return exportMessageAsMarkdownFile(message, includeReasoning)
  }, [])

  const exportToNotes = useCallback(
    async (message: MessageExportView) => {
      const title = await getMessageTitle(message)
      const markdown = await messageToMarkdown(message)
      return exportMessageToNotes(title, markdown, notesPath)
    },
    [notesPath]
  )

  const exportToNotion = useCallback(async (message: MessageExportView) => {
    const title = await getMessageTitle(message)
    const markdown = await messageToMarkdown(message)
    await exportMessageToNotion(title, markdown, message)
  }, [])

  const exportToYuque = useCallback(async (message: MessageExportView) => {
    const title = await getMessageTitle(message)
    const markdown = await messageToMarkdown(message)
    await exportMarkdownToYuque(title, markdown)
  }, [])

  const exportToObsidian = useCallback(
    async (message: MessageExportView) => {
      const title = topicName?.replace(/\\/g, '_') || 'Untitled'
      await ObsidianExportPopup.show({ title, message, processingMethod: '1' })
    },
    [topicName]
  )

  const exportToJoplin = useCallback(async (message: MessageExportView) => {
    const title = await getMessageTitle(message)
    await exportMarkdownToJoplin(title, message)
  }, [])

  const exportToSiyuan = useCallback(async (message: MessageExportView) => {
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
      exportToYuque,
      saveImage,
      saveTextFile,
      saveToKnowledge
    ]
  )
}
