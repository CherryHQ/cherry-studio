import { Client } from '@libsql/client'
import { loggerService } from '@logger'
import { AgentSchema } from './database/schema'

const logger = loggerService.withContext('AgentDatabaseService')

export interface AgentData {
  id: string
  name: string
  description?: string
  system_prompt: string
  model: string
  tools: string // JSON string
  knowledges: string // JSON string
}

export class AgentDatabaseService {
  private _db: Client
  private isInitialized = false

  constructor(database: Client) {
    this._db = database
  }

  get db(): Client {
    return this._db
  }

  /**
   * Initialize database schema by creating tables and indexes
   */
  async initializeSchema(): Promise<void> {
    if (this.isInitialized) {
      logger.debug('Schema already initialized, skipping')
      return
    }

    try {
      logger.info('Initializing agent database schema')
      
      // Enable foreign key constraints
      await this._db.execute('PRAGMA foreign_keys = ON')

      // Create tables in dependency order
      logger.verbose('Creating agents table')
      await this._db.execute(AgentSchema.createTables.agents)
      
      logger.verbose('Creating sessions table')
      await this._db.execute(AgentSchema.createTables.sessions)
      
      logger.verbose('Creating session_logs table')
      await this._db.execute(AgentSchema.createTables.sessionLogs)

      // Create indexes for performance
      logger.verbose('Creating database indexes')
      const indexQueries = Object.values(AgentSchema.createIndexes)
      await Promise.all(indexQueries.map(query => this._db.execute(query)))

      this.isInitialized = true
      logger.info('Agent database schema initialized successfully')
    } catch (error) {
      logger.error('Failed to initialize agent database schema', error)
      throw new Error(`Schema initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Validate agent data before persistence
   */
  async validateAgentData(data: AgentData): Promise<void> {
    logger.debug('Validating agent data', { agentId: data.id, name: data.name })

    try {
      // Validate required fields
      this.validateRequiredFields(data)
      
      // Validate JSON fields
      this.validateJsonFields(data)

      logger.verbose('Agent data validation passed', { agentId: data.id })
    } catch (error) {
      logger.warn('Agent data validation failed', error, { agentId: data.id })
      throw error
    }
  }

  /**
   * Validate required string fields
   */
  private validateRequiredFields(data: AgentData): void {
    const requiredFields = [
      { field: 'name', value: data.name },
      { field: 'system_prompt', value: data.system_prompt },
      { field: 'model', value: data.model }
    ]

    for (const { field, value } of requiredFields) {
      if (!value?.trim()) {
        throw new Error(`Agent ${field.replace('_', ' ')} is required`)
      }
    }
  }

  /**
   * Validate JSON format in string fields
   */
  private validateJsonFields(data: AgentData): void {
    const jsonFields = [
      { field: 'tools', value: data.tools },
      { field: 'knowledges', value: data.knowledges }
    ]

    for (const { field, value } of jsonFields) {
      try {
        JSON.parse(value)
      } catch (error) {
        throw new Error(`Invalid JSON format in ${field} field`)
      }
    }
  }

  /**
   * Check if schema is initialized
   */
  get initialized(): boolean {
    return this.isInitialized
  }
}