import { loggerService } from '@logger'
import { AgentModelValidationError, agentService, sessionService } from '@main/services/agents'
import type { ListAgentsResponse } from '@types'
import { type ReplaceAgentRequest, type UpdateAgentRequest } from '@types'
import type { Request, Response } from 'express'

import type { ValidationRequest } from '../validators/zodValidator'

const logger = loggerService.withContext('ApiServerAgentsHandlers')

const modelValidationErrorBody = (error: AgentModelValidationError) => ({
  error: {
    message: `Invalid ${error.context.field}: ${error.detail.message}`,
    type: 'invalid_request_error',
    code: error.detail.code
  }
})

/**
 * @swagger
 * /v1/agents:
 *   post:
 *     summary: Create a new agent
 *     description: Creates a new autonomous agent with the specified configuration and automatically
 *       provisions an initial session that mirrors the agent's settings.
 *     tags: [Agents]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAgentRequest'
 *     responses:
 *       201:
 *         description: Agent created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AgentEntity'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export const createAgent = async (req: Request, res: Response): Promise<Response> => {
  try {
    logger.debug('Creating agent')
    logger.debug('Agent payload', { body: req.body })

    const agent = await agentService.createAgent(req.body)

    try {
      logger.info('Agent created', { agentId: agent.id })
      logger.debug('Creating default session for agent', { agentId: agent.id })

      await sessionService.createSession(agent.id, {})

      logger.info('Default session created for agent', { agentId: agent.id })
      return res.status(201).json(agent)
    } catch (sessionError: any) {
      logger.error('Failed to create default session for new agent, rolling back agent creation', {
        agentId: agent.id,
        error: sessionError
      })

      try {
        await agentService.deleteAgent(agent.id)
      } catch (rollbackError: any) {
        logger.error('Failed to roll back agent after session creation failure', {
          agentId: agent.id,
          error: rollbackError
        })
      }

      return res.status(500).json({
        error: {
          message: `Failed to create default session for agent: ${sessionError.message}`,
          type: 'internal_error',
          code: 'agent_session_creation_failed'
        }
      })
    }
  } catch (error: any) {
    if (error instanceof AgentModelValidationError) {
      logger.warn('Agent model validation error during create', {
        agentType: error.context.agentType,
        field: error.context.field,
        model: error.context.model,
        detail: error.detail
      })
      return res.status(400).json(modelValidationErrorBody(error))
    }

    logger.error('Error creating agent', { error })
    return res.status(500).json({
      error: {
        message: `Failed to create agent: ${error.message}`,
        type: 'internal_error',
        code: 'agent_creation_failed'
      }
    })
  }
}

/**
 * @swagger
 * /v1/agents:
 *   get:
 *     summary: List all agents
 *     description: Retrieves a paginated list of all agents
 *     tags: [Agents]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of agents to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of agents to skip
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [created_at, updated_at, name]
 *           default: created_at
 *         description: Field to sort by
 *       - in: query
 *         name: orderBy
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order (asc = ascending, desc = descending)
 *     responses:
 *       200:
 *         description: List of agents
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AgentEntity'
 *                 total:
 *                   type: integer
 *                   description: Total number of agents
 *                 limit:
 *                   type: integer
 *                   description: Number of agents returned
 *                 offset:
 *                   type: integer
 *                   description: Number of agents skipped
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export const listAgents = async (req: Request, res: Response): Promise<Response> => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0
    const sortBy = (req.query.sortBy as 'created_at' | 'updated_at' | 'name') || 'created_at'
    const orderBy = (req.query.orderBy as 'asc' | 'desc') || 'desc'

    logger.debug('Listing agents', { limit, offset, sortBy, orderBy })

    const result = await agentService.listAgents({ limit, offset, sortBy, orderBy })

    logger.info('Agents listed', {
      returned: result.agents.length,
      total: result.total,
      limit,
      offset
    })
    return res.json({
      data: result.agents,
      total: result.total,
      limit,
      offset
    } satisfies ListAgentsResponse)
  } catch (error: any) {
    logger.error('Error listing agents', { error })
    return res.status(500).json({
      error: {
        message: 'Failed to list agents',
        type: 'internal_error',
        code: 'agent_list_failed'
      }
    })
  }
}

/**
 * @swagger
 * /v1/agents/{agentId}:
 *   get:
 *     summary: Get agent by ID
 *     description: Retrieves a specific agent by its ID
 *     tags: [Agents]
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *     responses:
 *       200:
 *         description: Agent details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AgentEntity'
 *       404:
 *         description: Agent not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export const getAgent = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { agentId } = req.params
    logger.debug('Getting agent', { agentId })

    const agent = await agentService.getAgent(agentId)

    if (!agent) {
      logger.warn('Agent not found', { agentId })
      return res.status(404).json({
        error: {
          message: 'Agent not found',
          type: 'not_found',
          code: 'agent_not_found'
        }
      })
    }

    logger.info('Agent retrieved', { agentId })
    return res.json(agent)
  } catch (error: any) {
    logger.error('Error getting agent', { error, agentId: req.params.agentId })
    return res.status(500).json({
      error: {
        message: 'Failed to get agent',
        type: 'internal_error',
        code: 'agent_get_failed'
      }
    })
  }
}

/**
 * @swagger
 * /v1/agents/{agentId}:
 *   put:
 *     summary: Update agent
 *     description: Updates an existing agent with the provided data
 *     tags: [Agents]
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAgentRequest'
 *     responses:
 *       200:
 *         description: Agent updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AgentEntity'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Agent not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export const updateAgent = async (req: Request, res: Response): Promise<Response> => {
  const { agentId } = req.params
  try {
    logger.debug('Updating agent', { agentId })
    logger.debug('Replace payload', { body: req.body })

    const { validatedBody } = req as ValidationRequest
    const replacePayload = (validatedBody ?? {}) as ReplaceAgentRequest

    const agent = await agentService.updateAgent(agentId, replacePayload, { replace: true })

    if (!agent) {
      logger.warn('Agent not found for update', { agentId })
      return res.status(404).json({
        error: {
          message: 'Agent not found',
          type: 'not_found',
          code: 'agent_not_found'
        }
      })
    }

    logger.info('Agent updated', { agentId })
    return res.json(agent)
  } catch (error: any) {
    if (error instanceof AgentModelValidationError) {
      logger.warn('Agent model validation error during update', {
        agentId,
        agentType: error.context.agentType,
        field: error.context.field,
        model: error.context.model,
        detail: error.detail
      })
      return res.status(400).json(modelValidationErrorBody(error))
    }

    logger.error('Error updating agent', { error, agentId })
    return res.status(500).json({
      error: {
        message: 'Failed to update agent: ' + error.message,
        type: 'internal_error',
        code: 'agent_update_failed'
      }
    })
  }
}

/**
 * @swagger
 * /v1/agents/{agentId}:
 *   patch:
 *     summary: Partially update agent
 *     description: Partially updates an existing agent with only the provided fields
 *     tags: [Agents]
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Agent name
 *               description:
 *                 type: string
 *                 description: Agent description
 *               avatar:
 *                 type: string
 *                 description: Agent avatar URL
 *               instructions:
 *                 type: string
 *                 description: System prompt/instructions
 *               model:
 *                 type: string
 *                 description: Main model ID
 *               plan_model:
 *                 type: string
 *                 description: Optional planning model ID
 *               small_model:
 *                 type: string
 *                 description: Optional small/fast model ID
 *               tools:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Tools
 *               mcps:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: MCP tool IDs
 *               knowledges:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Knowledge base IDs
 *               configuration:
 *                 type: object
 *                 description: Extensible settings
 *               accessible_paths:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Accessible directory paths
 *               permission_mode:
 *                 type: string
 *                 enum: [readOnly, acceptEdits, bypassPermissions]
 *                 description: Permission mode
 *               max_steps:
 *                 type: integer
 *                 description: Maximum steps the agent can take
 *             description: Only include the fields you want to update
 *     responses:
 *       200:
 *         description: Agent updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AgentEntity'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Agent not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export const patchAgent = async (req: Request, res: Response): Promise<Response> => {
  const { agentId } = req.params
  try {
    logger.debug('Partially updating agent', { agentId })
    logger.debug('Patch payload', { body: req.body })

    const { validatedBody } = req as ValidationRequest
    const updatePayload = (validatedBody ?? {}) as UpdateAgentRequest

    const agent = await agentService.updateAgent(agentId, updatePayload)

    if (!agent) {
      logger.warn('Agent not found for partial update', { agentId })
      return res.status(404).json({
        error: {
          message: 'Agent not found',
          type: 'not_found',
          code: 'agent_not_found'
        }
      })
    }

    logger.info('Agent patched', { agentId })
    return res.json(agent)
  } catch (error: any) {
    if (error instanceof AgentModelValidationError) {
      logger.warn('Agent model validation error during partial update', {
        agentId,
        agentType: error.context.agentType,
        field: error.context.field,
        model: error.context.model,
        detail: error.detail
      })
      return res.status(400).json(modelValidationErrorBody(error))
    }

    logger.error('Error partially updating agent', { error, agentId })
    return res.status(500).json({
      error: {
        message: `Failed to partially update agent: ${error.message}`,
        type: 'internal_error',
        code: 'agent_patch_failed'
      }
    })
  }
}

/**
 * @swagger
 * /v1/agents/{agentId}:
 *   delete:
 *     summary: Delete agent
 *     description: Deletes an agent and all associated sessions and logs
 *     tags: [Agents]
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *     responses:
 *       204:
 *         description: Agent deleted successfully
 *       404:
 *         description: Agent not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export const deleteAgent = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { agentId } = req.params
    logger.debug('Deleting agent', { agentId })

    const deleted = await agentService.deleteAgent(agentId)

    if (!deleted) {
      logger.warn('Agent not found for deletion', { agentId })
      return res.status(404).json({
        error: {
          message: 'Agent not found',
          type: 'not_found',
          code: 'agent_not_found'
        }
      })
    }

    logger.info('Agent deleted', { agentId })
    return res.status(204).send()
  } catch (error: any) {
    logger.error('Error deleting agent', { error, agentId: req.params.agentId })
    return res.status(500).json({
      error: {
        message: 'Failed to delete agent',
        type: 'internal_error',
        code: 'agent_delete_failed'
      }
    })
  }
}
