import { EventEmitter } from 'events'
import { loggerService } from '@logger'
import { v4 as uuidv4 } from 'uuid'
import { AgentDatabaseService } from './AgentDatabaseService'
import { SessionStatus, LogLevel, Session, SessionLog } from '../../../renderer/src/types/agent'

const logger = loggerService.withContext('SessionService')

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

export interface CreateSessionData {
  agent_id: string
}

export interface SessionListOptions {
  limit?: number
  offset?: number
  agentId?: string
  status?: SessionStatus
  // Performance optimization: date range filtering
  startDate?: Date
  endDate?: Date
  // Archival support
  includeArchived?: boolean
}

export interface SessionLogData {
  session_id: string
  level: LogLevel
  message: string
}

export interface SessionLogOptions {
  limit?: number
  offset?: number
  level?: LogLevel
  // Performance optimization: date range filtering for logs
  startDate?: Date
  endDate?: Date
}

export interface ResourceLimits {
  maxMemoryMB: number
  maxCpuPercent: number
  maxDurationMs: number
}

export interface ResourceUsage {
  memoryMB: number
  cpuPercent: number
  durationMs: number
}

export interface SessionStats {
  totalSessions: number
  runningSessions: number
  completedSessions: number
  failedSessions: number
  stoppedSessions: number
}

export interface StatusUpdateEvent {
  sessionId: string
  status: SessionStatus
  timestamp: Date
}

// =============================================================================
// SESSION SERVICE CLASS
// =============================================================================

export class SessionService extends EventEmitter {
  private dbService: AgentDatabaseService
  // Performance optimization: in-memory cache for recent sessions
  private sessionCache = new Map<string, Session>()
  private readonly CACHE_SIZE = 1000
  private readonly BATCH_SIZE = 100

  constructor(databaseService: AgentDatabaseService) {
    super()
    this.dbService = databaseService
  }

  // ===========================================================================
  // SESSION CRUD OPERATIONS
  // ===========================================================================

  /**
   * Create a new session for the specified agent
   * @param data Session creation data
   * @returns Created session
   * @throws Error if validation fails or agent doesn't exist
   */
  async createSession(data: CreateSessionData): Promise<Session> {
    logger.info('Creating new session', { agentId: data.agent_id })

    try {
      // Validate input data
      this.validateCreateSessionData(data)
      
      // Check if agent exists
      await this.ensureAgentExists(data.agent_id)

      // Create session object
      const session = this.buildNewSession(data)

      // Insert into database
      await this.insertSession(session)

      // Add to cache for performance
      this.addToCache(session)

      logger.info('Session created successfully', { sessionId: session.id, agentId: data.agent_id })
      return session
    } catch (error) {
      logger.error('Failed to create session', error, { agentId: data.agent_id })
      throw error
    }
  }

  /**
   * Retrieve a session by ID
   * @param sessionId Session ID to retrieve
   * @returns Session object or null if not found
   */
  async getSession(sessionId: string): Promise<Session | null> {
    logger.debug('Retrieving session', { sessionId })

    // Check cache first for performance
    const cachedSession = this.sessionCache.get(sessionId)
    if (cachedSession) {
      logger.debug('Session found in cache', { sessionId })
      return cachedSession
    }

    const result = await this.dbService.db.execute(
      'SELECT * FROM sessions WHERE id = ?',
      [sessionId]
    )

    if (result.rows.length === 0) {
      return null
    }

    const row = result.rows[0]
    const session = this.rowToSession(row)
    
    // Add to cache for next time
    this.addToCache(session)
    
    return session
  }

  /**
   * Update session status
   * @param sessionId Session ID to update
   * @param status New status
   * @returns Updated session
   * @throws Error if session not found or invalid status
   */
  async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<Session> {
    logger.debug('Updating session status', { sessionId, status })

    try {
      // Validate status
      this.validateSessionStatus(status)

      // Check if session exists
      const existingSession = await this.getSession(sessionId)
      if (!existingSession) {
        throw new Error('Session not found')
      }

      // Update in database
      const endedAt = this.shouldSetEndedAt(status) ? new Date() : null
      
      await this.dbService.db.execute(`
        UPDATE sessions 
        SET status = ?, ended_at = ?
        WHERE id = ?
      `, [status, endedAt?.toISOString() || null, sessionId])

      // Invalidate cache first to force fresh fetch
      this.sessionCache.delete(sessionId)

      // Get updated session (will fetch from database since cache is invalidated)
      const updatedSession = await this.getSession(sessionId)
      if (!updatedSession) {
        throw new Error('Failed to retrieve updated session')
      }

      // Emit status update event
      this.emit('statusUpdate', {
        sessionId,
        status,
        timestamp: new Date()
      } as StatusUpdateEvent)

      logger.debug('Session status updated successfully', { sessionId, status })
      return updatedSession
    } catch (error) {
      logger.error('Failed to update session status', error, { sessionId, status })
      throw error
    }
  }

  /**
   * List sessions with optional filtering and pagination
   * @param options Filtering and pagination options
   * @returns Array of sessions
   */
  async listSessions(options: SessionListOptions = {}): Promise<Session[]> {
    logger.debug('Listing sessions', options)

    let query = 'SELECT * FROM sessions'
    const params: any[] = []
    const conditions: string[] = []

    // Add filters
    if (options.agentId) {
      conditions.push('agent_id = ?')
      params.push(options.agentId)
    }

    if (options.status) {
      conditions.push('status = ?')
      params.push(options.status)
    }

    // Performance optimization: date range filtering
    if (options.startDate) {
      conditions.push('started_at >= ?')
      params.push(options.startDate.toISOString())
    }

    if (options.endDate) {
      conditions.push('started_at <= ?')
      params.push(options.endDate.toISOString())
    }

    // Archival support: exclude archived sessions by default
    if (!options.includeArchived) {
      conditions.push('status != ?')
      params.push('archived')
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }

    query += ' ORDER BY started_at DESC'

    // Add pagination with default limits for performance
    const limit = options.limit || 50 // Default limit for performance
    const offset = options.offset || 0

    query += ' LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const result = await this.dbService.db.execute(query, params)
    const sessions = result.rows.map(row => this.rowToSession(row))
    
    // Add to cache for future lookups
    sessions.forEach(session => this.addToCache(session))
    
    return sessions
  }

  // ===========================================================================
  // SESSION LOGGING
  // ===========================================================================

  /**
   * Add a log entry to a session
   * @param data Log data
   * @returns Created log entry
   * @throws Error if validation fails or session doesn't exist
   */
  async addSessionLog(data: SessionLogData): Promise<SessionLog> {
    logger.debug('Adding session log', { sessionId: data.session_id, level: data.level })

    try {
      // Validate log data
      this.validateSessionLogData(data)
      
      // Check if session exists
      const session = await this.getSession(data.session_id)
      if (!session) {
        throw new Error('Session not found')
      }

      // Create log object
      const log = this.buildNewSessionLog(data)

      // Insert into database
      await this.insertSessionLog(log)

      logger.debug('Session log added successfully', { sessionId: data.session_id, logId: log.id })
      return log
    } catch (error) {
      logger.error('Failed to add session log', error, { sessionId: data.session_id })
      throw error
    }
  }

  /**
   * Get logs for a session
   * @param sessionId Session ID
   * @param options Filtering and pagination options
   * @returns Array of session logs
   */
  async getSessionLogs(sessionId: string, options: SessionLogOptions = {}): Promise<SessionLog[]> {
    logger.debug('Retrieving session logs', { sessionId, options })

    let query = 'SELECT * FROM session_logs WHERE session_id = ?'
    const params: any[] = [sessionId]

    // Add level filter
    if (options.level) {
      query += ' AND level = ?'
      params.push(options.level)
    }

    // Performance optimization: date range filtering for logs
    if (options.startDate) {
      query += ' AND timestamp >= ?'
      params.push(options.startDate.toISOString())
    }

    if (options.endDate) {
      query += ' AND timestamp <= ?'
      params.push(options.endDate.toISOString())
    }

    query += ' ORDER BY timestamp ASC'

    // Add pagination with default limits for performance
    const limit = options.limit || 100 // Default limit for performance
    const offset = options.offset || 0

    query += ' LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const result = await this.dbService.db.execute(query, params)
    return result.rows.map(row => this.rowToSessionLog(row))
  }

  // ===========================================================================
  // RESOURCE LIMITS MANAGEMENT
  // ===========================================================================

  /**
   * Check if session exceeds resource limits and terminate if necessary
   * @param sessionId Session ID to check
   * @param limits Resource limits configuration
   * @param usage Current resource usage
   */
  async checkResourceLimits(
    sessionId: string, 
    limits: ResourceLimits, 
    usage: ResourceUsage
  ): Promise<void> {
    logger.debug('Checking resource limits', { sessionId, limits, usage })

    try {
      const session = await this.getSession(sessionId)
      if (!session) {
        throw new Error('Session not found')
      }

      // Check if any limit is exceeded
      const violations: string[] = []

      if (usage.memoryMB > limits.maxMemoryMB) {
        violations.push(`Memory usage ${usage.memoryMB}MB exceeds limit ${limits.maxMemoryMB}MB`)
      }

      if (usage.cpuPercent > limits.maxCpuPercent) {
        violations.push(`CPU usage ${usage.cpuPercent}% exceeds limit ${limits.maxCpuPercent}%`)
      }

      if (usage.durationMs > limits.maxDurationMs) {
        violations.push(`Duration ${usage.durationMs}ms exceeds limit ${limits.maxDurationMs}ms`)
      }

      if (violations.length > 0) {
        // Log resource limit violation
        await this.addSessionLog({
          session_id: sessionId,
          level: LogLevel.WARN,
          message: `Resource limit exceeded: ${violations.join(', ')}`
        })

        // Terminate session
        await this.updateSessionStatus(sessionId, SessionStatus.STOPPED)

        logger.warn('Session terminated due to resource limit violation', { 
          sessionId, 
          violations 
        })
      }
    } catch (error) {
      logger.error('Failed to check resource limits', error, { sessionId })
      throw error
    }
  }

  // ===========================================================================
  // ARCHIVAL AND CLEANUP METHODS
  // ===========================================================================

  /**
   * Archive old completed sessions for performance
   * @param olderThanDays Archive sessions older than this many days
   * @returns Number of sessions archived
   */
  async archiveOldSessions(olderThanDays: number = 30): Promise<number> {
    logger.info('Archiving old sessions', { olderThanDays })

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)

    const result = await this.dbService.db.execute(`
      UPDATE sessions 
      SET status = 'archived' 
      WHERE status IN ('completed', 'failed', 'stopped') 
        AND ended_at < ?
        AND status != 'archived'
    `, [cutoffDate.toISOString()])

    const archivedCount = Number(result.changes)
    
    // Clear cache entries for archived sessions
    this.clearCacheForArchivedSessions()

    logger.info('Sessions archived successfully', { archivedCount, cutoffDate })
    return archivedCount
  }

  /**
   * Permanently delete archived sessions and their logs
   * @param olderThanDays Delete archived sessions older than this many days
   * @returns Number of sessions deleted
   */
  async deleteArchivedSessions(olderThanDays: number = 90): Promise<number> {
    logger.info('Deleting archived sessions', { olderThanDays })

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)

    // Get sessions to delete for logging
    const sessionsToDelete = await this.dbService.db.execute(`
      SELECT id FROM sessions 
      WHERE status = 'archived' AND ended_at < ?
    `, [cutoffDate.toISOString()])

    if (sessionsToDelete.rows.length === 0) {
      logger.info('No archived sessions to delete')
      return 0
    }

    // Delete session logs first (foreign key constraint)
    await this.dbService.db.execute(`
      DELETE FROM session_logs 
      WHERE session_id IN (
        SELECT id FROM sessions 
        WHERE status = 'archived' AND ended_at < ?
      )
    `, [cutoffDate.toISOString()])

    // Delete sessions
    const result = await this.dbService.db.execute(`
      DELETE FROM sessions 
      WHERE status = 'archived' AND ended_at < ?
    `, [cutoffDate.toISOString()])

    const deletedCount = Number(result.changes)
    
    // Clear cache
    sessionsToDelete.rows.forEach(row => {
      this.sessionCache.delete(row.id as string)
    })

    logger.info('Archived sessions deleted successfully', { deletedCount, cutoffDate })
    return deletedCount
  }

  /**
   * Batch add multiple session logs for performance
   * @param logs Array of log data to add
   * @returns Array of created logs
   */
  async addSessionLogsBatch(logs: SessionLogData[]): Promise<SessionLog[]> {
    logger.debug('Adding session logs in batch', { count: logs.length })

    if (logs.length === 0) {
      return []
    }

    // Validate all logs first
    for (const log of logs) {
      this.validateSessionLogData(log)
      
      // Check if session exists (batch validation could be optimized further)
      const session = await this.getSession(log.session_id)
      if (!session) {
        throw new Error(`Session not found: ${log.session_id}`)
      }
    }

    // Process in batches to avoid overwhelming the database
    const result: SessionLog[] = []
    for (let i = 0; i < logs.length; i += this.BATCH_SIZE) {
      const batch = logs.slice(i, i + this.BATCH_SIZE)
      
      for (const logData of batch) {
        const log = this.buildNewSessionLog(logData)
        await this.insertSessionLog(log)
        result.push(log)
      }
    }

    logger.debug('Session logs batch added successfully', { count: result.length })
    return result
  }

  // ===========================================================================
  // SESSION STATISTICS
  // ===========================================================================

  /**
   * Get overall session statistics
   * @returns Session statistics
   */
  async getSessionStats(): Promise<SessionStats> {
    logger.debug('Retrieving session statistics')

    const result = await this.dbService.db.execute(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'stopped' THEN 1 ELSE 0 END) as stopped
      FROM sessions
    `)

    const row = result.rows[0]
    return {
      totalSessions: Number(row.total),
      runningSessions: Number(row.running),
      completedSessions: Number(row.completed),
      failedSessions: Number(row.failed),
      stoppedSessions: Number(row.stopped)
    }
  }

  /**
   * Get session statistics for a specific agent
   * @param agentId Agent ID
   * @returns Session statistics for the agent
   */
  async getSessionStatsByAgent(agentId: string): Promise<SessionStats> {
    logger.debug('Retrieving session statistics by agent', { agentId })

    const result = await this.dbService.db.execute(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'stopped' THEN 1 ELSE 0 END) as stopped
      FROM sessions
      WHERE agent_id = ?
    `, [agentId])

    const row = result.rows[0]
    return {
      totalSessions: Number(row.total),
      runningSessions: Number(row.running),
      completedSessions: Number(row.completed),
      failedSessions: Number(row.failed),
      stoppedSessions: Number(row.stopped)
    }
  }

  // ===========================================================================
  // PRIVATE HELPER METHODS
  // ===========================================================================

  /**
   * Validate session creation data
   */
  private validateCreateSessionData(data: CreateSessionData): void {
    if (!data.agent_id?.trim()) {
      throw new Error('Agent ID cannot be empty')
    }
  }

  /**
   * Validate session status
   */
  private validateSessionStatus(status: SessionStatus): void {
    if (!Object.values(SessionStatus).includes(status)) {
      throw new Error('Invalid session status')
    }
  }

  /**
   * Validate session log data
   */
  private validateSessionLogData(data: SessionLogData): void {
    if (!data.session_id?.trim()) {
      throw new Error('Session ID cannot be empty')
    }

    if (!data.message?.trim()) {
      throw new Error('Log message cannot be empty')
    }

    if (!Object.values(LogLevel).includes(data.level)) {
      throw new Error('Invalid log level')
    }
  }

  /**
   * Ensure agent exists
   */
  private async ensureAgentExists(agentId: string): Promise<void> {
    const result = await this.dbService.db.execute(
      'SELECT COUNT(*) as count FROM agents WHERE id = ?',
      [agentId]
    )

    const count = result.rows[0].count as number
    if (count === 0) {
      throw new Error('Agent not found')
    }
  }

  /**
   * Build new session object
   */
  private buildNewSession(data: CreateSessionData): Session {
    const now = new Date()
    return {
      id: uuidv4(),
      agent_id: data.agent_id,
      status: SessionStatus.RUNNING,
      started_at: now,
      ended_at: null
    }
  }

  /**
   * Build new session log object
   */
  private buildNewSessionLog(data: SessionLogData): SessionLog {
    // We'll use a temporary ID that gets replaced by database auto-increment
    return {
      id: 0, // Will be set by database auto-increment
      session_id: data.session_id,
      level: data.level,
      message: data.message,
      timestamp: new Date()
    }
  }

  /**
   * Insert session into database
   */
  private async insertSession(session: Session): Promise<void> {
    await this.dbService.db.execute(`
      INSERT INTO sessions (id, agent_id, status, started_at, ended_at)
      VALUES (?, ?, ?, ?, ?)
    `, [
      session.id,
      session.agent_id,
      session.status,
      session.started_at.toISOString(),
      session.ended_at?.toISOString() || null
    ])
  }

  /**
   * Insert session log into database
   */
  private async insertSessionLog(log: SessionLog): Promise<void> {
    const result = await this.dbService.db.execute(`
      INSERT INTO session_logs (session_id, level, message, timestamp)
      VALUES (?, ?, ?, ?)
    `, [
      log.session_id,
      log.level,
      log.message,
      log.timestamp.toISOString()
    ])

    // Update the log object with the actual database ID
    log.id = Number(result.lastInsertRowid)
  }

  /**
   * Convert database row to Session object
   */
  private rowToSession(row: any): Session {
    return {
      id: row.id as string,
      agent_id: row.agent_id as string,
      status: row.status as SessionStatus,
      started_at: new Date(row.started_at as string),
      ended_at: row.ended_at ? new Date(row.ended_at as string) : null
    }
  }

  /**
   * Convert database row to SessionLog object
   */
  private rowToSessionLog(row: any): SessionLog {
    return {
      id: Number(row.id),
      session_id: row.session_id as string,
      level: row.level as LogLevel,
      message: row.message as string,
      timestamp: new Date(row.timestamp as string)
    }
  }

  /**
   * Determine if ended_at should be set for given status
   */
  private shouldSetEndedAt(status: SessionStatus): boolean {
    return status === SessionStatus.COMPLETED || 
           status === SessionStatus.FAILED || 
           status === SessionStatus.STOPPED
  }

  // ===========================================================================
  // CACHE MANAGEMENT HELPERS
  // ===========================================================================

  /**
   * Add session to cache with LRU eviction
   */
  private addToCache(session: Session): void {
    // Remove if already exists to update position
    if (this.sessionCache.has(session.id)) {
      this.sessionCache.delete(session.id)
    }

    // Add to cache
    this.sessionCache.set(session.id, session)

    // Evict oldest if cache is full
    if (this.sessionCache.size > this.CACHE_SIZE) {
      const firstKey = this.sessionCache.keys().next().value
      this.sessionCache.delete(firstKey)
    }
  }

  /**
   * Clear cache entries for archived sessions
   */
  private clearCacheForArchivedSessions(): void {
    for (const [sessionId, session] of this.sessionCache.entries()) {
      if (session.status === 'archived' as SessionStatus) {
        this.sessionCache.delete(sessionId)
      }
    }
  }

  /**
   * Clear entire cache (useful for testing or memory management)
   */
  private clearCache(): void {
    this.sessionCache.clear()
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): { size: number; maxSize: number; hitRate?: number } {
    return {
      size: this.sessionCache.size,
      maxSize: this.CACHE_SIZE
      // Hit rate tracking could be added if needed
    }
  }
}