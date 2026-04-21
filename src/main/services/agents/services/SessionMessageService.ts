import { loggerService } from '@logger'
import type { AgentSessionMessageEntity, ListOptions } from '@types'
import { and, eq } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import { sessionMessagesTable } from '../database/schema'

const logger = loggerService.withContext('SessionMessageService')

export type CreateMessageOptions = {
  /** When true, persist user+assistant messages to DB on stream complete. Use for headless callers (channels, scheduler) where no UI handles persistence. */
  persist?: boolean
  /** Optional display-safe user content for persistence. When set, this is stored instead of req.content (which may contain security wrappers not meant for display). */
  displayContent?: string
  /** Images to persist in the user message for UI display (not sent to AI model). */
  images?: Array<{ data: string; media_type: string }>
}

/**
 * Reader/writer for the `agent_session_message` table.
 *
 * Scope deliberately trimmed to CRUD helpers (`sessionMessageExists`,
 * `listSessionMessages`, `deleteSessionMessage`) — live message creation and
 * streaming have moved to `AiStreamManager` + `AgentChatContextProvider`,
 * which own the user / placeholder reservation path (`reserveAssistantTurn`),
 * the execution pipeline, and persistence via `PersistenceListener`. The
 * upstream #14159 additions (`createSessionMessage`, stream orchestration,
 * `persistHeadlessExchange`, etc.) lived on top of the retired
 * `claudecode/tool-permissions.ts` + `channels/sessionStreamIpc.ts` path and
 * are not required here.
 *
 * Column access uses the camelCase names from the canonical `agentSessionMessage`
 * Drizzle schema (re-exported via `../database/schema/messages.schema.ts`).
 */
export class SessionMessageService extends BaseService {
  async sessionMessageExists(id: number): Promise<boolean> {
    const database = await this.getDatabase()
    const result = await database
      .select({ id: sessionMessagesTable.id })
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.id, id))
      .limit(1)

    return result.length > 0
  }

  async listSessionMessages(
    sessionId: string,
    options: ListOptions = {}
  ): Promise<{ messages: AgentSessionMessageEntity[] }> {
    // Get messages with pagination
    const database = await this.getDatabase()
    const baseQuery = database
      .select()
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.sessionId, sessionId))
      .orderBy(sessionMessagesTable.createdAt)

    const result =
      options.limit !== undefined
        ? options.offset !== undefined
          ? await baseQuery.limit(options.limit).offset(options.offset)
          : await baseQuery.limit(options.limit)
        : await baseQuery

    const messages = result.map((row) => this.deserializeSessionMessage(row))

    return { messages }
  }

  async deleteSessionMessage(sessionId: string, messageId: number): Promise<boolean> {
    const database = await this.getDatabase()
    const result = await database
      .delete(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.id, messageId), eq(sessionMessagesTable.sessionId, sessionId)))

    return result.rowsAffected > 0
  }

  private deserializeSessionMessage(data: any): AgentSessionMessageEntity {
    if (!data) return data

    const deserialized = { ...data }

    // Parse content JSON
    if (deserialized.content && typeof deserialized.content === 'string') {
      try {
        deserialized.content = JSON.parse(deserialized.content)
      } catch (error) {
        logger.warn(`Failed to parse content JSON:`, error as Error)
      }
    }

    // Parse metadata JSON
    if (deserialized.metadata && typeof deserialized.metadata === 'string') {
      try {
        deserialized.metadata = JSON.parse(deserialized.metadata)
      } catch (error) {
        logger.warn(`Failed to parse metadata JSON:`, error as Error)
      }
    }

    return deserialized
  }
}

export const sessionMessageService = new SessionMessageService()
