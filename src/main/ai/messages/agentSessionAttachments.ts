import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { AGENT_SESSION_MESSAGES_MAX_LIMIT } from '@shared/data/api/schemas/agentSessionMessages'
import type { CherryUIMessage } from '@shared/data/types/message'

import { collectAssistantFileAttachments } from './assistantFileAttachments'
import type { FileAttachmentRef } from './attachmentTypes'

/** Build the current attachment allow-list from persisted user messages in one Agent session. */
export function listAgentSessionAttachments(sessionId: string): FileAttachmentRef[] {
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

  return collectAssistantFileAttachments(messages.reverse())
}
