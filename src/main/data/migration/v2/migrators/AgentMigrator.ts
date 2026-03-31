/**
 * Agent migrator - migrates agents, sessions, and messages from agents.db to v2 SQLite
 *
 * Data source: legacy agents.db (separate SQLite file)
 * - agents table → agent table
 * - sessions table → agent_session table + topic table (sourceType='agent')
 * - session_messages table → message table (with agentSessionId + agentSnapshot)
 *
 * Unlike other migrators that read from Redux/Dexie, this one opens agents.db
 * directly via libsql since the data lives in a separate database file.
 */

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { createClient } from '@libsql/client'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import type { AgentSessionSnapshot } from '@shared/data/types/agent'
import type { MessageData } from '@shared/data/types/message'
import { sql } from 'drizzle-orm'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'
import {
  AgentTransformSchema,
  LegacyMessageRowSchema,
  makeSessionTransformWithFkCheck,
  transformBlocksToMessageData
} from './mappings/AgentMappings'

const logger = loggerService.withContext('AgentMigrator')

interface PreparedAgent {
  id: string
  type: string
  name: string
  description: string | null
  model: string
  planModel: string | null
  smallModel: string | null
  accessiblePaths: string[] | null
  instructions: Record<string, unknown> | null
  mcps: string[] | null
  allowedTools: string[] | null
  configuration: Record<string, unknown> | null
  sortOrder: number
}

interface PreparedSession {
  id: string
  agentId: string
  agentType: string
  topicId: string
  name: string
  description: string | null
  model: string
  planModel: string | null
  smallModel: string | null
  accessiblePaths: string[] | null
  instructions: Record<string, unknown> | null
  mcps: string[] | null
  allowedTools: string[] | null
  slashCommands: unknown[] | null
  configuration: Record<string, unknown> | null
  sortOrder: number
}

interface PreparedMessage {
  topicId: string
  role: string
  data: MessageData
  status: string
  agentSessionId: string
  agentSnapshot: AgentSessionSnapshot
  createdAt: number
}

export class AgentMigrator extends BaseMigrator {
  readonly id = 'agent'
  readonly name = 'Agent'
  readonly description = 'Migrate agents, sessions, and messages from agents.db to v2 SQLite'
  readonly order = 5

  private preparedAgents: PreparedAgent[] = []
  private preparedSessions: PreparedSession[] = []
  private preparedMessages: PreparedMessage[] = []
  private skippedCount = 0

  /**
   * Resolve the path to legacy agents.db.
   * Checks both new Data/ path and old root path.
   */
  private getAgentsDbPath(): string | null {
    const newPath = path.join(app.getPath('userData'), 'Data', 'agents.db')
    if (fs.existsSync(newPath)) return newPath

    const oldPath = path.join(app.getPath('userData'), 'agents.db')
    if (fs.existsSync(oldPath)) return oldPath

    return null
  }

  async prepare(_ctx: MigrationContext): Promise<PrepareResult> {
    this.preparedAgents = []
    this.preparedSessions = []
    this.preparedMessages = []
    this.skippedCount = 0
    const warnings: string[] = []

    try {
      const dbPath = this.getAgentsDbPath()
      if (!dbPath) {
        logger.info('No agents.db found, skipping agent migration')
        return { success: true, itemCount: 0, warnings: ['agents.db not found, skipping'] }
      }

      const client = createClient({ url: `file:${dbPath}`, intMode: 'number' })

      try {
        // 1. Read agents
        const agentRows = await client.execute('SELECT * FROM agents ORDER BY sort_order')
        const validAgentIds = new Set<string>()

        for (const row of agentRows.rows) {
          try {
            const parsed = AgentTransformSchema.parse(row)
            this.preparedAgents.push(parsed)
            validAgentIds.add(parsed.id)
          } catch (err) {
            this.skippedCount++
            warnings.push(`Skipped agent: ${(err as Error).message}`)
          }
        }

        // 2. Read sessions (with FK validation)
        const sessionRows = await client.execute('SELECT * FROM sessions ORDER BY sort_order')
        const sessionTransform = makeSessionTransformWithFkCheck(validAgentIds)
        const validSessionIds = new Set<string>()
        const sessionAgentMap = new Map<string, PreparedAgent>()

        for (const row of sessionRows.rows) {
          try {
            const parsed = sessionTransform.parse(row)
            // Generate a topicId for this session (will be created during execute)
            const topicId = crypto.randomUUID()
            this.preparedSessions.push({ ...parsed, topicId })
            validSessionIds.add(parsed.id)

            const agent = this.preparedAgents.find((a) => a.id === parsed.agentId)
            if (agent) sessionAgentMap.set(parsed.id, agent)
          } catch (err) {
            this.skippedCount++
            warnings.push(`Skipped session: ${(err as Error).message}`)
          }
        }

        // 3. Read messages (with FK validation)
        const msgRows = await client.execute('SELECT * FROM session_messages ORDER BY created_at')

        for (const row of msgRows.rows) {
          try {
            const parsed = LegacyMessageRowSchema.parse(row)

            if (!validSessionIds.has(parsed.session_id)) {
              this.skippedCount++
              warnings.push(`Skipped message with invalid session_id: ${parsed.session_id}`)
              continue
            }

            const session = this.preparedSessions.find((s) => s.id === parsed.session_id)
            if (!session) continue

            // Build message data from legacy content
            const blocks = parsed.content?.blocks ?? []
            const data = transformBlocksToMessageData(blocks)

            // Build agent snapshot
            const agentSnapshot: AgentSessionSnapshot = {
              agentId: session.agentId,
              agentType: session.agentType,
              model: session.model,
              planModel: session.planModel,
              smallModel: session.smallModel,
              instructions: session.instructions,
              mcps: session.mcps,
              allowedTools: session.allowedTools,
              configuration: session.configuration
            }

            // Map legacy role
            let role = parsed.role
            if (role === 'agent') role = 'assistant'

            this.preparedMessages.push({
              topicId: session.topicId,
              role,
              data,
              status: 'success',
              agentSessionId: session.id,
              agentSnapshot,
              createdAt: new Date(parsed.created_at).getTime()
            })
          } catch (err) {
            this.skippedCount++
            warnings.push(`Skipped message: ${(err as Error).message}`)
          }
        }
      } finally {
        client.close()
      }

      const totalItems = this.preparedAgents.length + this.preparedSessions.length + this.preparedMessages.length

      logger.info('Preparation completed', {
        agents: this.preparedAgents.length,
        sessions: this.preparedSessions.length,
        messages: this.preparedMessages.length,
        skipped: this.skippedCount
      })

      return {
        success: true,
        itemCount: totalItems,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    } catch (error) {
      logger.error('Preparation failed', error as Error)
      return {
        success: false,
        itemCount: 0,
        warnings: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    const totalItems = this.preparedAgents.length + this.preparedSessions.length + this.preparedMessages.length
    if (totalItems === 0) {
      return { success: true, processedCount: 0 }
    }

    try {
      let processed = 0
      const BATCH_SIZE = 100

      await ctx.db.transaction(async (tx) => {
        // 1. Insert agents
        for (let i = 0; i < this.preparedAgents.length; i += BATCH_SIZE) {
          const batch = this.preparedAgents.slice(i, i + BATCH_SIZE)
          await tx.insert(agentTable).values(batch)
          processed += batch.length
        }

        // 2. Insert topics for sessions
        for (let i = 0; i < this.preparedSessions.length; i += BATCH_SIZE) {
          const batch = this.preparedSessions.slice(i, i + BATCH_SIZE)
          await tx.insert(topicTable).values(
            batch.map((s) => ({
              id: s.topicId,
              name: s.name,
              sourceType: 'agent',
              isNameManuallyEdited: false
            }))
          )
        }

        // 3. Insert sessions
        for (let i = 0; i < this.preparedSessions.length; i += BATCH_SIZE) {
          const batch = this.preparedSessions.slice(i, i + BATCH_SIZE)
          await tx.insert(agentSessionTable).values(batch)
          processed += batch.length
        }

        // 4. Insert messages
        for (let i = 0; i < this.preparedMessages.length; i += BATCH_SIZE) {
          const batch = this.preparedMessages.slice(i, i + BATCH_SIZE)
          await tx.insert(messageTable).values(batch)
          processed += batch.length
        }
      })

      this.reportProgress(100, `Migrated ${processed} items`, {
        key: 'migration.progress.migrated_agents',
        params: {
          agents: this.preparedAgents.length,
          sessions: this.preparedSessions.length,
          messages: this.preparedMessages.length
        }
      })

      logger.info('Execute completed', { processedCount: processed })
      return { success: true, processedCount: processed }
    } catch (error) {
      logger.error('Execute failed', error as Error)
      return {
        success: false,
        processedCount: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    try {
      const errors: { key: string; message: string }[] = []

      const [agentCount, sessionCount, messageCount] = await Promise.all([
        ctx.db.select({ count: sql<number>`count(*)` }).from(agentTable).get(),
        ctx.db.select({ count: sql<number>`count(*)` }).from(agentSessionTable).get(),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(messageTable)
          .where(sql`${messageTable.agentSessionId} IS NOT NULL`)
          .get()
      ])

      const actualAgents = agentCount?.count ?? 0
      const actualSessions = sessionCount?.count ?? 0
      const actualMessages = messageCount?.count ?? 0

      if (actualAgents !== this.preparedAgents.length) {
        errors.push({
          key: 'agent_count_mismatch',
          message: `Expected ${this.preparedAgents.length} agents but found ${actualAgents}`
        })
      }

      if (actualSessions !== this.preparedSessions.length) {
        errors.push({
          key: 'session_count_mismatch',
          message: `Expected ${this.preparedSessions.length} sessions but found ${actualSessions}`
        })
      }

      if (actualMessages !== this.preparedMessages.length) {
        errors.push({
          key: 'message_count_mismatch',
          message: `Expected ${this.preparedMessages.length} messages but found ${actualMessages}`
        })
      }

      const totalSource = this.preparedAgents.length + this.preparedSessions.length + this.preparedMessages.length
      const totalTarget = actualAgents + actualSessions + actualMessages

      return {
        success: errors.length === 0,
        errors,
        stats: {
          sourceCount: totalSource,
          targetCount: totalTarget,
          skippedCount: this.skippedCount
        }
      }
    } catch (error) {
      logger.error('Validation failed', error as Error)
      return {
        success: false,
        errors: [{ key: 'validation', message: error instanceof Error ? error.message : String(error) }],
        stats: {
          sourceCount: this.preparedAgents.length + this.preparedSessions.length + this.preparedMessages.length,
          targetCount: 0,
          skippedCount: this.skippedCount
        }
      }
    }
  }
}
