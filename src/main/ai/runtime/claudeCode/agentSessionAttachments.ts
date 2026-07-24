import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { createFileAttachmentHandle } from '@main/ai/messages/attachmentHandle'
import { collectFileAttachments } from '@main/ai/messages/attachmentRouting'
import type { FileAttachmentRef } from '@main/ai/messages/attachmentTypes'
import { AGENT_SESSION_MESSAGES_MAX_LIMIT } from '@shared/data/api/schemas/agentSessionMessages'
import type { CherryUIMessage } from '@shared/data/types/message'

export interface AgentSessionAttachmentHolder {
  register(attachments: ReadonlyArray<FileAttachmentRef>): ReadonlyArray<FileAttachmentRef>
  list(): ReadonlyArray<FileAttachmentRef>
  dispose(): void
}

const attachmentHolders = new Map<string, AgentSessionAttachmentHolder>()

export function listPersistedAgentSessionAttachments(sessionId: string): FileAttachmentRef[] {
  const messages: CherryUIMessage[] = []
  let cursor: string | undefined

  do {
    const page = agentSessionMessageService.listSessionMessages(sessionId, {
      cursor,
      limit: AGENT_SESSION_MESSAGES_MAX_LIMIT
    })
    for (const message of page.items) {
      if (message.role !== 'user') continue
      messages.push({ id: message.id, role: 'user', parts: message.data.parts } as CherryUIMessage)
    }
    cursor = page.nextCursor
  } while (cursor)

  if (messages.length === 0) return []
  messages.reverse()
  return collectFileAttachments(messages)
}

/**
 * Create the live attachment allow-list for one Claude Code connection.
 *
 * The MCP server resolves this holder by session id at call time, so a prewarmed
 * query sees attachments registered after it was created. Disposal is
 * identity-checked because an older connection may close after its successor.
 */
export function createAgentSessionAttachmentHolder(
  sessionId: string,
  initialAttachments: ReadonlyArray<FileAttachmentRef> = []
): AgentSessionAttachmentHolder {
  const attachments: FileAttachmentRef[] = []
  const byEntryId = new Map<string, FileAttachmentRef>()

  // Fires asynchronously, so referencing `holder` before its declaration resolves at call time.
  const deletionSubscription = agentSessionMessageService.onSessionMessageDeleted(({ sessionId: changedSessionId }) => {
    if (changedSessionId !== sessionId) return

    // Fail closed: a refresh error must not leave handles from the deleted transcript authorized.
    attachments.length = 0
    byEntryId.clear()
    holder.register(listPersistedAgentSessionAttachments(sessionId))
  })

  const holder: AgentSessionAttachmentHolder = {
    register(nextAttachments) {
      for (const attachment of nextAttachments) {
        if (byEntryId.has(attachment.fileEntryId)) continue

        const displayName = attachment.displayName.trim() || 'file'
        const registered = {
          fileEntryId: attachment.fileEntryId,
          handle: createFileAttachmentHandle(attachment.fileEntryId),
          displayName
        }
        byEntryId.set(registered.fileEntryId, registered)
        attachments.push(registered)
      }
      return attachments
    },
    list: () => attachments,
    dispose() {
      deletionSubscription.dispose()
      attachments.length = 0
      byEntryId.clear()
      if (attachmentHolders.get(sessionId) === holder) attachmentHolders.delete(sessionId)
    }
  }

  attachmentHolders.set(sessionId, holder)
  holder.register(initialAttachments)
  return holder
}

export function getAgentSessionAttachments(sessionId: string | undefined): ReadonlyArray<FileAttachmentRef> {
  return sessionId ? (attachmentHolders.get(sessionId)?.list() ?? []) : []
}
