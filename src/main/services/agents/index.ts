import { loggerService } from '@logger'
import { v4 as uuidv4 } from 'uuid'
import { AgentDatabaseService } from './AgentDatabaseService'

const logger = loggerService.withContext('AgentService')

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

export interface CreateAgentData {
  name: string
  description?: string
  system_prompt: string
  model: string
  tools: any[]
  knowledges: any[]
}

export interface UpdateAgentData {
  name?: string
  description?: string
  system_prompt?: string
  model?: string
  tools?: any[]
  knowledges?: any[]
}

export interface Agent {
  id: string
  name: string
  description?: string
  system_prompt: string
  model: string
  tools: any[]
  knowledges: any[]
  status: string
  created_at: Date
  updated_at: Date
}

export interface ListAgentsOptions {
  limit?: number
  offset?: number
  nameFilter?: string
}

// =============================================================================
// AGENT SERVICE CLASS
// =============================================================================

export class AgentService {
  private dbService: AgentDatabaseService

  constructor(databaseService: AgentDatabaseService) {
    this.dbService = databaseService
  }

  // ===========================================================================
  // PUBLIC METHODS
  // ===========================================================================

  /**
   * Create a new agent with the provided data
   * @param data Agent creation data
   * @returns Created agent
   * @throws Error if validation fails or duplicate name exists
   */
  async createAgent(data: CreateAgentData): Promise<Agent> {
    logger.info('Creating new agent', { name: data.name })

    try {
      // Sanitize and validate input
      const sanitizedData = this.sanitizeCreateData(data)
      await this.validateCreateData(sanitizedData)
      
      // Check for duplicate name
      await this.ensureUniqueAgentName(sanitizedData.name)

      // Create agent object
      const agent = this.buildNewAgent(sanitizedData)

      // Validate and persist
      await this.validateAndInsertAgent(agent)

      logger.info('Agent created successfully', { agentId: agent.id, name: agent.name })
      return agent
    } catch (error) {
      logger.error('Failed to create agent', error, { name: data.name })
      throw error
    }
  }

  async getAgent(id: string): Promise<Agent | null> {
    logger.debug('Retrieving agent', { agentId: id })

    const result = await this.dbService.db.execute(
      'SELECT * FROM agents WHERE id = ?',
      [id]
    )

    if (result.rows.length === 0) {
      return null
    }

    const row = result.rows[0]
    return this.rowToAgent(row)
  }

  async getAgentByName(name: string): Promise<Agent | null> {
    const result = await this.dbService.db.execute(
      'SELECT * FROM agents WHERE name = ?',
      [name]
    )

    if (result.rows.length === 0) {
      return null
    }

    const row = result.rows[0]
    return this.rowToAgent(row)
  }

  async updateAgent(id: string, data: UpdateAgentData): Promise<Agent> {
    logger.info('Updating agent', { agentId: id })

    // Check if agent exists
    const existingAgent = await this.getAgent(id)
    if (!existingAgent) {
      throw new Error('Agent not found')
    }

    // Check for duplicate name if name is being updated
    if (data.name && data.name !== existingAgent.name) {
      const duplicateAgent = await this.getAgentByName(data.name)
      if (duplicateAgent) {
        throw new Error(`Agent with name "${data.name}" already exists`)
      }
    }

    // Prepare updated data
    const updatedAgent: Agent = {
      ...existingAgent,
      ...data,
      updated_at: new Date()
    }

    // Update in database
    await this.dbService.db.execute(`
      UPDATE agents 
      SET name = ?, description = ?, system_prompt = ?, model = ?, tools = ?, knowledges = ?, updated_at = ?
      WHERE id = ?
    `, [
      updatedAgent.name,
      updatedAgent.description || null,
      updatedAgent.system_prompt,
      updatedAgent.model,
      JSON.stringify(updatedAgent.tools),
      JSON.stringify(updatedAgent.knowledges),
      updatedAgent.updated_at.toISOString(),
      id
    ])

    logger.info('Agent updated successfully', { agentId: id })
    return updatedAgent
  }

  async deleteAgent(id: string): Promise<void> {
    logger.info('Deleting agent', { agentId: id })

    // Check if agent exists
    const existingAgent = await this.getAgent(id)
    if (!existingAgent) {
      throw new Error('Agent not found')
    }

    // Check for active sessions
    const sessionsResult = await this.dbService.db.execute(
      'SELECT COUNT(*) as count FROM sessions WHERE agent_id = ? AND status = ?',
      [id, 'running']
    )

    const activeSessionCount = sessionsResult.rows[0].count as number
    if (activeSessionCount > 0) {
      throw new Error('Cannot delete agent with active sessions')
    }

    // Delete agent
    await this.dbService.db.execute('DELETE FROM agents WHERE id = ?', [id])

    logger.info('Agent deleted successfully', { agentId: id })
  }

  async listAgents(options: ListAgentsOptions = {}): Promise<Agent[]> {
    logger.debug('Listing agents', options)

    let query = 'SELECT * FROM agents'
    const params: any[] = []

    if (options.nameFilter) {
      query += ' WHERE name LIKE ?'
      params.push(`%${options.nameFilter}%`)
    }

    query += ' ORDER BY created_at DESC'

    if (options.limit) {
      query += ' LIMIT ?'
      params.push(options.limit)
    }

    if (options.offset) {
      query += ' OFFSET ?'
      params.push(options.offset)
    }

    const result = await this.dbService.db.execute(query, params)
    return result.rows.map(row => this.rowToAgent(row))
  }

  // ===========================================================================
  // PRIVATE HELPER METHODS
  // ===========================================================================

  /**
   * Sanitize input data for agent creation
   */
  private sanitizeCreateData(data: CreateAgentData): CreateAgentData {
    const sanitized = {
      name: data.name?.trim(),
      description: data.description?.trim(),
      system_prompt: data.system_prompt?.trim(),
      model: data.model,
      tools: data.tools,
      knowledges: data.knowledges
    }

    // Remove dangerous content from description
    if (sanitized.description) {
      sanitized.description = sanitized.description
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    }

    return sanitized
  }

  /**
   * Validate create data
   */
  private async validateCreateData(data: CreateAgentData): Promise<void> {
    if (!data.name) {
      throw new Error('Agent name cannot be empty')
    }
  }

  /**
   * Ensure agent name is unique
   */
  private async ensureUniqueAgentName(name: string): Promise<void> {
    const existingAgent = await this.getAgentByName(name)
    if (existingAgent) {
      throw new Error(`Agent with name "${name}" already exists`)
    }
  }

  /**
   * Build new agent object
   */
  private buildNewAgent(data: CreateAgentData): Agent {
    const now = new Date()
    return {
      id: uuidv4(),
      name: data.name,
      description: data.description,
      system_prompt: data.system_prompt,
      model: data.model,
      tools: data.tools,
      knowledges: data.knowledges,
      status: 'idle',
      created_at: now,
      updated_at: now
    }
  }

  /**
   * Validate and insert agent into database
   */
  private async validateAndInsertAgent(agent: Agent): Promise<void> {
    // Validate agent data
    await this.dbService.validateAgentData({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      system_prompt: agent.system_prompt,
      model: agent.model,
      tools: JSON.stringify(agent.tools),
      knowledges: JSON.stringify(agent.knowledges)
    })

    // Insert into database
    await this.dbService.db.execute(`
      INSERT INTO agents (id, name, description, system_prompt, model, tools, knowledges, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      agent.id,
      agent.name,
      agent.description || null,
      agent.system_prompt,
      agent.model,
      JSON.stringify(agent.tools),
      JSON.stringify(agent.knowledges),
      agent.created_at.toISOString(),
      agent.updated_at.toISOString()
    ])
  }

  /**
   * Convert database row to Agent object
   */
  private rowToAgent(row: any): Agent {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      system_prompt: row.system_prompt as string,
      model: row.model as string,
      tools: JSON.parse(row.tools as string),
      knowledges: JSON.parse(row.knowledges as string),
      status: 'idle', // Default status
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string)
    }
  }
}