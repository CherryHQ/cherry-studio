import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { exportMarkdownContentAsFile, messagesToMarkdown } from '@renderer/services/ExportService'
import { toast } from '@renderer/services/toast'
import type { MessageExportView } from '@renderer/types/messageExport'
import type { Model } from '@renderer/types/model'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { messagesToPlainText } from '@renderer/utils/export'
import { markdownToPlainText } from '@renderer/utils/markdown'
import {
  AGENT_SESSION_MESSAGES_MAX_LIMIT,
  type AgentSessionEntity,
  type AgentSessionMessageEntity
} from '@shared/data/api/schemas/agentSessions'
import type { CursorPaginationResponse } from '@shared/data/api/types'
import type { ModelSnapshot } from '@shared/data/types/message'
import i18next from 'i18next'

const logger = loggerService.withContext('agentSessionExport')

export type AgentSessionExportTarget = Pick<AgentSessionEntity, 'agentId' | 'id' | 'name'>

export interface AgentSessionExportOptions {
  modelFallback?: ModelSnapshot
}

export function getAgentSessionExportTitle(session: Pick<AgentSessionExportTarget, 'id' | 'name'>): string {
  return session.name.trim() || i18next.t('agent.session.new') || session.id
}

function modelSnapshotToModel(snapshot: ModelSnapshot | null | undefined): Model | undefined {
  if (!snapshot) return undefined

  return {
    id: snapshot.id,
    name: snapshot.name,
    provider: snapshot.provider,
    group: snapshot.group ?? ''
  }
}

function agentSessionMessageToExportView(
  row: AgentSessionMessageEntity,
  agentId: string | null | undefined,
  modelFallback?: ModelSnapshot
): MessageExportView {
  const modelSnapshot = row.modelSnapshot ?? (row.role === 'assistant' ? modelFallback : undefined)

  return {
    id: row.id,
    role: row.role,
    assistantId: agentId ?? undefined,
    topicId: buildAgentSessionTopicId(row.sessionId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    status: row.status,
    modelId: row.modelId ?? undefined,
    model: modelSnapshotToModel(modelSnapshot),
    stats: row.stats ?? undefined,
    parts: row.data.parts ?? []
  }
}

export async function getAgentSessionMessagesForExport(
  session: AgentSessionExportTarget,
  options: AgentSessionExportOptions = {}
): Promise<MessageExportView[]> {
  const pages: MessageExportView[][] = []
  let cursor: string | undefined

  do {
    const query = cursor
      ? { limit: AGENT_SESSION_MESSAGES_MAX_LIMIT, cursor }
      : { limit: AGENT_SESSION_MESSAGES_MAX_LIMIT }
    const response = (await dataApiService.get(`/agent-sessions/${session.id}/messages`, {
      query
    })) as CursorPaginationResponse<AgentSessionMessageEntity>

    pages.push(
      response.items.map((row) => agentSessionMessageToExportView(row, session.agentId, options.modelFallback))
    )
    cursor = response.nextCursor
  } while (cursor)

  return pages.reverse().flatMap((page) => page.reverse())
}

export async function agentSessionToMarkdown(
  session: AgentSessionExportTarget,
  exportReasoning?: boolean,
  excludeCitations?: boolean,
  options: AgentSessionExportOptions = {}
): Promise<string> {
  const title = getAgentSessionExportTitle(session)
  const messages = await getAgentSessionMessagesForExport(session, options)

  if (messages.length === 0) return `# ${title}`

  return `# ${title}\n\n${await messagesToMarkdown(messages, exportReasoning, excludeCitations)}`
}

export async function agentSessionToPlainText(
  session: AgentSessionExportTarget,
  options: AgentSessionExportOptions = {}
): Promise<string> {
  const title = markdownToPlainText(getAgentSessionExportTitle(session)).trim()
  const messages = await getAgentSessionMessagesForExport(session, options)

  if (messages.length === 0) return title

  return `${title}\n\n${messagesToPlainText(messages)}`
}

export async function copyAgentSessionAsMarkdown(
  session: AgentSessionExportTarget,
  options: AgentSessionExportOptions = {}
): Promise<void> {
  try {
    const markdown = await agentSessionToMarkdown(session, undefined, undefined, options)
    await navigator.clipboard.writeText(markdown)
    toast.success(i18next.t('message.copy.success'))
  } catch (error) {
    logger.error('Failed to copy agent session as markdown', error as Error, { sessionId: session.id })
    toast.error(i18next.t('common.copy_failed'))
  }
}

export async function copyAgentSessionAsPlainText(
  session: AgentSessionExportTarget,
  options: AgentSessionExportOptions = {}
): Promise<void> {
  try {
    const plainText = await agentSessionToPlainText(session, options)
    await navigator.clipboard.writeText(plainText)
    toast.success(i18next.t('message.copy.success'))
  } catch (error) {
    logger.error('Failed to copy agent session as plain text', error as Error, { sessionId: session.id })
    toast.error(i18next.t('common.copy_failed'))
  }
}

export async function exportAgentSessionAsMarkdown(
  session: AgentSessionExportTarget,
  exportReasoning?: boolean,
  excludeCitations?: boolean,
  options: AgentSessionExportOptions = {}
): Promise<void> {
  try {
    const markdown = await agentSessionToMarkdown(session, exportReasoning, excludeCitations, options)
    await exportMarkdownContentAsFile(getAgentSessionExportTitle(session), markdown)
  } catch (error) {
    logger.error('Failed to export agent session as markdown', error as Error, { sessionId: session.id })
    toast.error(i18next.t('chat.topics.export.failed'))
  }
}
