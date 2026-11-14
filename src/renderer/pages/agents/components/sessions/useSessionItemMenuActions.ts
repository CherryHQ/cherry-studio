import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import type { useUpdateSession } from '@renderer/hooks/agent/useSession'
import { useConversationExportMenuOptions } from '@renderer/hooks/chat/useConversationExportMenuOptions'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { finishTopicRenaming, startTopicRenaming } from '@renderer/hooks/useTopic'
import { ipcApi } from '@renderer/ipc'
import type { AgentSessionExportOptions } from '@renderer/services/agentSessionExport'
import { showImageActionFeedback } from '@renderer/services/imageActionFeedback'
import { toast } from '@renderer/services/toast'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { fetchMessagesSummary } from '@renderer/utils/aiGeneration'
import { removeSpecialCharactersForFileName } from '@renderer/utils/file'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import {
  type AgentSessionImageActionRequest,
  type AgentSessionImageActionType,
  requestAgentSessionImageAction
} from '../../messages/agentSessionImageActionBus'
import type { SessionItemMenuActions } from './SessionItem'

const logger = loggerService.withContext('AgentSessions')

interface UseSessionItemMenuActionsOptions {
  getSessionExportOptions: (session: AgentSessionEntity) => AgentSessionExportOptions
  queueImageCaptureTarget: (request: AgentSessionImageActionRequest, session: AgentSessionEntity) => void
  updateSession: ReturnType<typeof useUpdateSession>['updateSession']
}

export function useSessionItemMenuActions({
  getSessionExportOptions,
  queueImageCaptureTarget,
  updateSession
}: UseSessionItemMenuActionsOptions) {
  const { t } = useTranslation()
  const { notesPath } = useNotesSettings()
  const exportMenuOptions = useConversationExportMenuOptions()

  const handleAutoRenameSession = useCallback(
    async (session: AgentSessionEntity) => {
      const { getAgentSessionMessagesForExport } = await import('@renderer/services/agentSessionExport')
      const messages = await getAgentSessionMessagesForExport(session)
      if (messages.length < 2) return

      const topicId = buildAgentSessionTopicId(session.id)
      startTopicRenaming(topicId)
      try {
        const { text: summaryText, error: summaryError } = await fetchMessagesSummary({ messages })
        if (summaryText) {
          await updateSession(
            { id: session.id, name: summaryText, isNameManuallyEdited: false },
            { showSuccessToast: false }
          )
        } else if (summaryError) {
          toast.error(`${t('message.error.fetchTopicName')}: ${summaryError}`)
        }
      } finally {
        finishTopicRenaming(topicId)
      }
    },
    [t, updateSession]
  )

  const handleSessionImageAction = useCallback(
    (type: AgentSessionImageActionType, session: AgentSessionEntity) => {
      const request = requestAgentSessionImageAction(type, session)
      showImageActionFeedback(type, request, 'agent-session-image-export', t)
      queueImageCaptureTarget(request, session)
    },
    [queueImageCaptureTarget, t]
  )

  const handleSaveSessionToNotes = useCallback(
    async (session: AgentSessionEntity) => {
      const [{ agentSessionToMarkdown, getAgentSessionExportTitle }, { exportContentToNotes }] = await Promise.all([
        import('@renderer/services/agentSessionExport'),
        import('@renderer/services/ExportService')
      ])
      const title = getAgentSessionExportTitle(session)
      const markdown = await agentSessionToMarkdown(session, undefined, undefined, getSessionExportOptions(session))
      await exportContentToNotes(title, markdown, notesPath)
    },
    [getSessionExportOptions, notesPath]
  )

  const handleSaveSessionToKnowledge = useCallback(
    async (session: AgentSessionEntity) => {
      try {
        const [{ getAgentSessionExportTitle, getAgentSessionMessagesForExport }, { default: SaveToKnowledgePopup }] =
          await Promise.all([
            import('@renderer/services/agentSessionExport'),
            import('@renderer/components/SaveToKnowledgePopup')
          ])
        const title = getAgentSessionExportTitle(session)
        const messages = await getAgentSessionMessagesForExport(session, getSessionExportOptions(session))
        const result = await SaveToKnowledgePopup.showForMessages(messages, title)
        if (result?.success) {
          toast.success(t('chat.save.topic.knowledge.success', { count: result.savedCount }))
        }
      } catch (err) {
        logger.error('Failed to save agent session to knowledge base', { err, sessionId: session.id })
        toast.error(t('chat.save.topic.knowledge.error.save_failed'))
      }
    },
    [getSessionExportOptions, t]
  )

  const handleCopySessionMarkdown = useCallback(
    async (session: AgentSessionEntity) => {
      const { copyAgentSessionAsMarkdown } = await import('@renderer/services/agentSessionExport')
      return copyAgentSessionAsMarkdown(session, getSessionExportOptions(session))
    },
    [getSessionExportOptions]
  )

  const handleCopySessionPlainText = useCallback(
    async (session: AgentSessionEntity) => {
      const { copyAgentSessionAsPlainText } = await import('@renderer/services/agentSessionExport')
      return copyAgentSessionAsPlainText(session, getSessionExportOptions(session))
    },
    [getSessionExportOptions]
  )

  const handleExportSessionMarkdown = useCallback(
    async (session: AgentSessionEntity) => {
      const { exportAgentSessionAsMarkdown } = await import('@renderer/services/agentSessionExport')
      return exportAgentSessionAsMarkdown(session, undefined, undefined, getSessionExportOptions(session))
    },
    [getSessionExportOptions]
  )

  const handleExportSessionMarkdownReason = useCallback(
    async (session: AgentSessionEntity) => {
      const { exportAgentSessionAsMarkdown } = await import('@renderer/services/agentSessionExport')
      return exportAgentSessionAsMarkdown(session, true, undefined, getSessionExportOptions(session))
    },
    [getSessionExportOptions]
  )

  const handleExportSessionWord = useCallback(
    async (session: AgentSessionEntity) => {
      const { agentSessionToMarkdown, getAgentSessionExportTitle } =
        await import('@renderer/services/agentSessionExport')
      const title = getAgentSessionExportTitle(session)
      const markdown = await agentSessionToMarkdown(session, undefined, undefined, getSessionExportOptions(session))
      await ipcApi.request('export.word.from_markdown', {
        markdown,
        fileName: removeSpecialCharactersForFileName(title)
      })
    },
    [getSessionExportOptions]
  )

  const handleExportSessionNotion = useCallback(
    async (session: AgentSessionEntity) => {
      const [{ getAgentSessionExportTitle, getAgentSessionMessagesForExport }, { exportMessagesToNotion }] =
        await Promise.all([import('@renderer/services/agentSessionExport'), import('@renderer/services/ExportService')])
      const title = getAgentSessionExportTitle(session)
      const messages = await getAgentSessionMessagesForExport(session, getSessionExportOptions(session))
      await exportMessagesToNotion(title, messages)
    },
    [getSessionExportOptions]
  )

  const handleExportSessionYuque = useCallback(
    async (session: AgentSessionEntity) => {
      const [{ agentSessionToMarkdown, getAgentSessionExportTitle }, { exportMarkdownToYuque }] = await Promise.all([
        import('@renderer/services/agentSessionExport'),
        import('@renderer/services/ExportService')
      ])
      const title = getAgentSessionExportTitle(session)
      const markdown = await agentSessionToMarkdown(session, undefined, undefined, getSessionExportOptions(session))
      await exportMarkdownToYuque(title, markdown)
    },
    [getSessionExportOptions]
  )

  const handleExportSessionObsidian = useCallback(
    async (session: AgentSessionEntity) => {
      const [{ getAgentSessionExportTitle, getAgentSessionMessagesForExport }, { default: ObsidianExportPopup }] =
        await Promise.all([
          import('@renderer/services/agentSessionExport'),
          import('@renderer/components/ObsidianExportPopup')
        ])
      const title = getAgentSessionExportTitle(session)
      const messages = await getAgentSessionMessagesForExport(session, getSessionExportOptions(session))
      await ObsidianExportPopup.show({ title: title.replace(/\\/g, '_'), messages, processingMethod: '3' })
    },
    [getSessionExportOptions]
  )

  const handleExportSessionJoplin = useCallback(
    async (session: AgentSessionEntity) => {
      const [{ getAgentSessionExportTitle, getAgentSessionMessagesForExport }, { exportMarkdownToJoplin }] =
        await Promise.all([import('@renderer/services/agentSessionExport'), import('@renderer/services/ExportService')])
      const title = getAgentSessionExportTitle(session)
      const messages = await getAgentSessionMessagesForExport(session, getSessionExportOptions(session))
      await exportMarkdownToJoplin(title, messages)
    },
    [getSessionExportOptions]
  )

  const handleExportSessionSiyuan = useCallback(
    async (session: AgentSessionEntity) => {
      const [{ agentSessionToMarkdown, getAgentSessionExportTitle }, { exportMarkdownToSiyuan }] = await Promise.all([
        import('@renderer/services/agentSessionExport'),
        import('@renderer/services/ExportService')
      ])
      const title = getAgentSessionExportTitle(session)
      const markdown = await agentSessionToMarkdown(session, undefined, undefined, getSessionExportOptions(session))
      await exportMarkdownToSiyuan(title, markdown)
    },
    [getSessionExportOptions]
  )

  const handleCopySessionImage = useCallback(
    (session: AgentSessionEntity) => {
      handleSessionImageAction('copy', session)
    },
    [handleSessionImageAction]
  )

  const handleExportSessionImage = useCallback(
    (session: AgentSessionEntity) => {
      handleSessionImageAction('export', session)
    },
    [handleSessionImageAction]
  )

  return useMemo<SessionItemMenuActions>(
    () => ({
      exportMenuOptions: exportMenuOptions,
      onAutoRename: handleAutoRenameSession,
      onCopyImage: handleCopySessionImage,
      onCopyMarkdown: handleCopySessionMarkdown,
      onCopyPlainText: handleCopySessionPlainText,
      onExportImage: handleExportSessionImage,
      onExportJoplin: handleExportSessionJoplin,
      onExportMarkdown: handleExportSessionMarkdown,
      onExportMarkdownReason: handleExportSessionMarkdownReason,
      onExportNotion: handleExportSessionNotion,
      onExportObsidian: handleExportSessionObsidian,
      onExportSiyuan: handleExportSessionSiyuan,
      onExportWord: handleExportSessionWord,
      onExportYuque: handleExportSessionYuque,
      onSaveToKnowledge: handleSaveSessionToKnowledge,
      onSaveToNotes: handleSaveSessionToNotes
    }),
    [
      exportMenuOptions,
      handleAutoRenameSession,
      handleCopySessionMarkdown,
      handleCopySessionPlainText,
      handleCopySessionImage,
      handleExportSessionImage,
      handleExportSessionJoplin,
      handleExportSessionMarkdown,
      handleExportSessionMarkdownReason,
      handleExportSessionNotion,
      handleExportSessionObsidian,
      handleExportSessionSiyuan,
      handleExportSessionWord,
      handleExportSessionYuque,
      handleSaveSessionToKnowledge,
      handleSaveSessionToNotes
    ]
  )
}
