import { loggerService } from '@logger'
import type { SessionLogEntity } from '@types'

import { BaseService } from '../BaseService'
import { AgentQueries_Legacy as AgentQueries } from '../database'

const logger = loggerService.withContext('SessionLogService')

export interface CreateSessionLogRequest {
  session_id: string
  parent_id?: number
  role: 'user' | 'agent' | 'system' | 'tool'
  type: string
  content: Record<string, any>
  metadata?: Record<string, any>
}

export interface UpdateSessionLogRequest {
  content?: Record<string, any>
  metadata?: Record<string, any>
}

export interface ListSessionLogsOptions {
  limit?: number
  offset?: number
}

export class SessionLogService extends BaseService {
  private static instance: SessionLogService | null = null

  static getInstance(): SessionLogService {
    if (!SessionLogService.instance) {
      SessionLogService.instance = new SessionLogService()
    }
    return SessionLogService.instance
  }

  async initialize(): Promise<void> {
    await BaseService.initialize()
  }

  async createSessionLog(logData: CreateSessionLogRequest): Promise<SessionLogEntity> {
    this.ensureInitialized()

    // Validate session exists - we'll need to import SessionService for this check
    // For now, we'll skip this validation to avoid circular dependencies
    // The database foreign key constraint will handle this

    // Validate parent exists if specified
    if (logData.parent_id) {
      const parentExists = await this.sessionLogExists(logData.parent_id)
      if (!parentExists) {
        throw new Error(`Parent log with id ${logData.parent_id} does not exist`)
      }
    }

    const now = new Date().toISOString()

    const values = [
      logData.session_id,
      logData.parent_id || null,
      logData.role,
      logData.type,
      JSON.stringify(logData.content),
      logData.metadata ? JSON.stringify(logData.metadata) : null,
      now,
      now
    ]

    const result = await this.database.execute({
      sql: AgentQueries.sessionLogs.insert,
      args: values
    })

    if (!result.lastInsertRowid) {
      throw new Error('Failed to create session log')
    }

    const logResult = await this.database.execute({
      sql: AgentQueries.sessionLogs.getById,
      args: [result.lastInsertRowid]
    })

    if (!logResult.rows[0]) {
      throw new Error('Failed to retrieve created session log')
    }

    return this.deserializeSessionLog(logResult.rows[0]) as SessionLogEntity
  }

  async getSessionLog(id: number): Promise<SessionLogEntity | null> {
    this.ensureInitialized()

    const result = await this.database.execute({
      sql: AgentQueries.sessionLogs.getById,
      args: [id]
    })

    if (!result.rows[0]) {
      return null
    }

    return this.deserializeSessionLog(result.rows[0]) as SessionLogEntity
  }

  async listSessionLogs(
    sessionId: string,
    options: ListSessionLogsOptions = {}
  ): Promise<{ logs: SessionLogEntity[]; total: number }> {
    this.ensureInitialized()

    // Get total count
    const countResult = await this.database.execute({
      sql: AgentQueries.sessionLogs.countBySessionId,
      args: [sessionId]
    })
    const total = (countResult.rows[0] as any).total

    // Get logs with pagination
    let query: string
    const args: any[] = [sessionId]

    if (options.limit !== undefined) {
      query = AgentQueries.sessionLogs.getBySessionIdWithPagination
      args.push(options.limit)

      if (options.offset !== undefined) {
        args.push(options.offset)
      } else {
        args.push(0)
      }
    } else {
      query = AgentQueries.sessionLogs.getBySessionId
    }

    const result = await this.database.execute({
      sql: query,
      args: args
    })

    const logs = result.rows.map((row) => this.deserializeSessionLog(row)) as SessionLogEntity[]

    return { logs, total }
  }

  async updateSessionLog(id: number, updates: UpdateSessionLogRequest): Promise<SessionLogEntity | null> {
    this.ensureInitialized()

    // Check if log exists
    const existing = await this.getSessionLog(id)
    if (!existing) {
      return null
    }

    const now = new Date().toISOString()

    const values = [
      updates.content !== undefined ? JSON.stringify(updates.content) : JSON.stringify(existing.content),
      updates.metadata !== undefined
        ? updates.metadata
          ? JSON.stringify(updates.metadata)
          : null
        : existing.metadata
          ? JSON.stringify(existing.metadata)
          : null,
      now,
      id
    ]

    await this.database.execute({
      sql: AgentQueries.sessionLogs.update,
      args: values
    })

    return await this.getSessionLog(id)
  }

  async deleteSessionLog(id: number): Promise<boolean> {
    this.ensureInitialized()

    const result = await this.database.execute({
      sql: AgentQueries.sessionLogs.deleteById,
      args: [id]
    })

    return result.rowsAffected > 0
  }

  async sessionLogExists(id: number): Promise<boolean> {
    this.ensureInitialized()

    const result = await this.database.execute({
      sql: AgentQueries.sessionLogs.getById,
      args: [id]
    })

    return result.rows.length > 0
  }

  async bulkCreateSessionLogs(logs: CreateSessionLogRequest[]): Promise<SessionLogEntity[]> {
    this.ensureInitialized()

    const results: SessionLogEntity[] = []

    // Use a transaction for bulk insert
    for (const logData of logs) {
      const result = await this.createSessionLog(logData)
      results.push(result)
    }

    return results
  }

  private deserializeSessionLog(data: any): SessionLogEntity {
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

export const sessionLogService = SessionLogService.getInstance()
