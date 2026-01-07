import express from 'express'

import { agentHandlers, messageHandlers, sessionHandlers } from './handlers'
import { checkAgentExists, handleValidationErrors } from './middleware'
import {
  validateAgent,
  validateAgentId,
  validateAgentReplace,
  validateAgentUpdate,
  validatePagination,
  validateSession,
  validateSessionId,
  validateSessionMessage,
  validateSessionMessageId,
  validateSessionReplace,
  validateSessionUpdate
} from './validators'

// Create main agents router
const agentsRouter = express.Router()

/**
 * @swagger
 * components:
 *   schemas:
 *     PermissionMode:
 *       type: string
 *       enum: [default, acceptEdits, bypassPermissions, plan]
 *       description: Permission mode for agent operations
 *
 *     AgentType:
 *       type: string
 *       enum: [claude-code]
 *       description: Type of agent
 *
 *     AgentConfiguration:
 *       type: object
 *       properties:
 *         permission_mode:
 *           $ref: '#/components/schemas/PermissionMode'
 *           default: default
 *         max_turns:
 *           type: integer
 *           default: 10
 *           description: Maximum number of interaction turns
 *       additionalProperties: true
 *
 *     AgentBase:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           description: Agent name
 *         description:
 *           type: string
 *           description: Agent description
 *         accessible_paths:
 *           type: array
 *           items:
 *             type: string
 *           description: Array of directory paths the agent can access
 *         instructions:
 *           type: string
 *           description: System prompt/instructions
 *         model:
 *           type: string
 *           description: Main model ID
 *         plan_model:
 *           type: string
 *           description: Optional planning model ID
 *         small_model:
 *           type: string
 *           description: Optional small/fast model ID
 *         mcps:
 *           type: array
 *           items:
 *             type: string
 *           description: Array of MCP tool IDs
 *         allowed_tools:
 *           type: array
 *           items:
 *             type: string
 *           description: Array of allowed tool IDs (whitelist)
 *         configuration:
 *           $ref: '#/components/schemas/AgentConfiguration'
 *       required:
 *         - model
 *         - accessible_paths
 *
 *     AgentEntity:
 *       allOf:
 *         - $ref: '#/components/schemas/AgentBase'
 *         - type: object
 *           properties:
 *             id:
 *               type: string
 *               description: Unique agent identifier
 *             type:
 *               $ref: '#/components/schemas/AgentType'
 *             created_at:
 *               type: string
 *               format: date-time
 *               description: ISO timestamp of creation
 *             updated_at:
 *               type: string
 *               format: date-time
 *               description: ISO timestamp of last update
 *           required:
 *             - id
 *             - type
 *             - created_at
 *             - updated_at
 *     CreateAgentRequest:
 *       allOf:
 *         - $ref: '#/components/schemas/AgentBase'
 *         - type: object
 *           properties:
 *             type:
 *               $ref: '#/components/schemas/AgentType'
 *             name:
 *               type: string
 *               minLength: 1
 *               description: Agent name (required)
 *             model:
 *               type: string
 *               minLength: 1
 *               description: Main model ID (required)
 *           required:
 *             - type
 *             - name
 *             - model
 *
 *     UpdateAgentRequest:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           description: Agent name
 *         description:
 *           type: string
 *           description: Agent description
 *         accessible_paths:
 *           type: array
 *           items:
 *             type: string
 *           description: Array of directory paths the agent can access
 *         instructions:
 *           type: string
 *           description: System prompt/instructions
 *         model:
 *           type: string
 *           description: Main model ID
 *         plan_model:
 *           type: string
 *           description: Optional planning model ID
 *         small_model:
 *           type: string
 *           description: Optional small/fast model ID
 *         mcps:
 *           type: array
 *           items:
 *             type: string
 *           description: Array of MCP tool IDs
 *         allowed_tools:
 *           type: array
 *           items:
 *             type: string
 *           description: Array of allowed tool IDs (whitelist)
 *         configuration:
 *           $ref: '#/components/schemas/AgentConfiguration'
 *       description: Partial update - all fields are optional
 *
 *     ReplaceAgentRequest:
 *       $ref: '#/components/schemas/AgentBase'
 *
 *     SessionEntity:
 *       allOf:
 *         - $ref: '#/components/schemas/AgentBase'
 *         - type: object
 *           properties:
 *             id:
 *               type: string
 *               description: Unique session identifier
 *             agent_id:
 *               type: string
 *               description: Primary agent ID for the session
 *             agent_type:
 *               $ref: '#/components/schemas/AgentType'
 *             created_at:
 *               type: string
 *               format: date-time
 *               description: ISO timestamp of creation
 *             updated_at:
 *               type: string
 *               format: date-time
 *               description: ISO timestamp of last update
 *           required:
 *             - id
 *             - agent_id
 *             - agent_type
 *             - created_at
 *             - updated_at
 *
 *     CreateSessionRequest:
 *       allOf:
 *         - $ref: '#/components/schemas/AgentBase'
 *         - type: object
 *           properties:
 *             model:
 *               type: string
 *               minLength: 1
 *               description: Main model ID (required)
 *           required:
 *             - model
 *
 *     UpdateSessionRequest:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           description: Session name
 *         description:
 *           type: string
 *           description: Session description
 *         accessible_paths:
 *           type: array
 *           items:
 *             type: string
 *           description: Array of directory paths the agent can access
 *         instructions:
 *           type: string
 *           description: System prompt/instructions
 *         model:
 *           type: string
 *           description: Main model ID
 *         plan_model:
 *           type: string
 *           description: Optional planning model ID
 *         small_model:
 *           type: string
 *           description: Optional small/fast model ID
 *         mcps:
 *           type: array
 *           items:
 *             type: string
 *           description: Array of MCP tool IDs
 *         allowed_tools:
 *           type: array
 *           items:
 *             type: string
 *           description: Array of allowed tool IDs (whitelist)
 *         configuration:
 *           $ref: '#/components/schemas/AgentConfiguration'
 *       description: Partial update - all fields are optional
 *
 *     ReplaceSessionRequest:
 *       allOf:
 *         - $ref: '#/components/schemas/AgentBase'
 *         - type: object
 *           properties:
 *             model:
 *               type: string
 *               minLength: 1
 *               description: Main model ID (required)
 *           required:
 *             - model
 *
 *     CreateSessionMessageRequest:
 *       type: object
 *       properties:
 *         content:
 *           type: string
 *           minLength: 1
 *           description: Message content
 *       required:
 *         - content
 *
 *     PaginationQuery:
 *       type: object
 *       properties:
 *         limit:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *           description: Number of items to return
 *         offset:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *           description: Number of items to skip
 *         status:
 *           type: string
 *           enum: [idle, running, completed, failed, stopped]
 *           description: Filter by session status
 *
 *     ListAgentsResponse:
 *       type: object
 *       properties:
 *         agents:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/AgentEntity'
 *         total:
 *           type: integer
 *           description: Total number of agents
 *         limit:
 *           type: integer
 *           description: Number of items returned
 *         offset:
 *           type: integer
 *           description: Number of items skipped
 *       required:
 *         - agents
 *         - total
 *         - limit
 *         - offset
 *
 *     ListSessionsResponse:
 *       type: object
 *       properties:
 *         sessions:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/SessionEntity'
 *         total:
 *           type: integer
 *           description: Total number of sessions
 *         limit:
 *           type: integer
 *           description: Number of items returned
 *         offset:
 *           type: integer
 *           description: Number of items skipped
 *       required:
 *         - sessions
 *         - total
 *         - limit
 *         - offset
 *
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         error:
 *           type: object
 *           properties:
 *             message:
 *               type: string
 *               description: Error message
 *             type:
 *               type: string
 *               description: Error type
 *             code:
 *               type: string
 *               description: Error code
 *           required:
 *             - message
 *             - type
 *             - code
 *       required:
 *         - error
 */

/**
 * @swagger
 * /agents:
 *   post:
 *     summary: Create a new agent
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
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// Agent CRUD routes
agentsRouter.post('/', validateAgent, handleValidationErrors, agentHandlers.createAgent)

/**
 * @swagger
 * /agents:
 *   get:
 *     summary: List all agents with pagination
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [idle, running, completed, failed, stopped]
 *         description: Filter by agent status
 *     responses:
 *       200:
 *         description: List of agents
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ListAgentsResponse'
 */
agentsRouter.get('/', validatePagination, handleValidationErrors, agentHandlers.listAgents)

/**
 * @swagger
 * /agents/{agentId}:
 *   get:
 *     summary: Get agent by ID
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
 *               $ref: '#/components/schemas/ErrorResponse'
 */
agentsRouter.get('/:agentId', validateAgentId, handleValidationErrors, agentHandlers.getAgent)
/**
 * @swagger
 * /agents/{agentId}:
 *   put:
 *     summary: Replace agent (full update)
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
 *             $ref: '#/components/schemas/ReplaceAgentRequest'
 *     responses:
 *       200:
 *         description: Agent updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AgentEntity'
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Agent not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
agentsRouter.put('/:agentId', validateAgentId, validateAgentReplace, handleValidationErrors, agentHandlers.updateAgent)
/**
 * @swagger
 * /agents/{agentId}:
 *   patch:
 *     summary: Update agent (partial update)
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
 *             $ref: '#/components/schemas/UpdateAgentRequest'
 *     responses:
 *       200:
 *         description: Agent updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AgentEntity'
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Agent not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
agentsRouter.patch('/:agentId', validateAgentId, validateAgentUpdate, handleValidationErrors, agentHandlers.patchAgent)
/**
 * @swagger
 * /agents/{agentId}:
 *   delete:
 *     summary: Delete agent
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
 *               $ref: '#/components/schemas/ErrorResponse'
 */
agentsRouter.delete('/:agentId', validateAgentId, handleValidationErrors, agentHandlers.deleteAgent)

// Create sessions router with agent context
const createSessionsRouter = (): express.Router => {
  const sessionsRouter = express.Router({ mergeParams: true })

  // Session CRUD routes (nested under agent)
  /**
   * @swagger
   * /agents/{agentId}/sessions:
   *   post:
   *     summary: Create a new session for an agent
   *     tags: [Sessions]
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
   *             $ref: '#/components/schemas/CreateSessionRequest'
   *     responses:
   *       201:
   *         description: Session created successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SessionEntity'
   *       400:
   *         description: Invalid request body
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: Agent not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  sessionsRouter.post('/', validateSession, handleValidationErrors, sessionHandlers.createSession)

  /**
   * @swagger
   * /agents/{agentId}/sessions:
   *   get:
   *     summary: List sessions for an agent
   *     tags: [Sessions]
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *           default: 20
   *         description: Number of sessions to return
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           minimum: 0
   *           default: 0
   *         description: Number of sessions to skip
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [idle, running, completed, failed, stopped]
   *         description: Filter by session status
   *     responses:
   *       200:
   *         description: List of sessions
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ListSessionsResponse'
   *       404:
   *         description: Agent not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  sessionsRouter.get('/', validatePagination, handleValidationErrors, sessionHandlers.listSessions)
  /**
   * @swagger
   * /agents/{agentId}/sessions/{sessionId}:
   *   get:
   *     summary: Get session by ID
   *     tags: [Sessions]
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *         description: Session ID
   *     responses:
   *       200:
   *         description: Session details
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SessionEntity'
   *       404:
   *         description: Agent or session not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  sessionsRouter.get('/:sessionId', validateSessionId, handleValidationErrors, sessionHandlers.getSession)
  /**
   * @swagger
   * /agents/{agentId}/sessions/{sessionId}:
   *   put:
   *     summary: Replace session (full update)
   *     tags: [Sessions]
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *         description: Session ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/ReplaceSessionRequest'
   *     responses:
   *       200:
   *         description: Session updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SessionEntity'
   *       400:
   *         description: Invalid request body
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: Agent or session not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  sessionsRouter.put(
    '/:sessionId',
    validateSessionId,
    validateSessionReplace,
    handleValidationErrors,
    sessionHandlers.updateSession
  )
  /**
   * @swagger
   * /agents/{agentId}/sessions/{sessionId}:
   *   patch:
   *     summary: Update session (partial update)
   *     tags: [Sessions]
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *         description: Session ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UpdateSessionRequest'
   *     responses:
   *       200:
   *         description: Session updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SessionEntity'
   *       400:
   *         description: Invalid request body
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: Agent or session not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  sessionsRouter.patch(
    '/:sessionId',
    validateSessionId,
    validateSessionUpdate,
    handleValidationErrors,
    sessionHandlers.patchSession
  )
  /**
   * @swagger
   * /agents/{agentId}/sessions/{sessionId}:
   *   delete:
   *     summary: Delete session
   *     tags: [Sessions]
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *         description: Session ID
   *     responses:
   *       204:
   *         description: Session deleted successfully
   *       404:
   *         description: Agent or session not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  sessionsRouter.delete('/:sessionId', validateSessionId, handleValidationErrors, sessionHandlers.deleteSession)

  return sessionsRouter
}

// Create messages router with agent and session context
const createMessagesRouter = (): express.Router => {
  const messagesRouter = express.Router({ mergeParams: true })

  // Message CRUD routes (nested under agent/session)
  /**
   * @swagger
   * /agents/{agentId}/sessions/{sessionId}/messages:
   *   post:
   *     summary: Create a new message in a session
   *     tags: [Messages]
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *         description: Session ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateSessionMessageRequest'
   *     responses:
   *       201:
   *         description: Message created successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id:
   *                   type: number
   *                   description: Message ID
   *                 session_id:
   *                   type: string
   *                   description: Session ID
   *                 role:
   *                   type: string
   *                   enum: [assistant, user, system, tool]
   *                   description: Message role
   *                 content:
   *                   type: object
   *                   description: Message content (AI SDK format)
   *                 agent_session_id:
   *                   type: string
   *                   description: Agent session ID for resuming
   *                 metadata:
   *                   type: object
   *                   description: Additional metadata
   *                 created_at:
   *                   type: string
   *                   format: date-time
   *                 updated_at:
   *                   type: string
   *                   format: date-time
   *       400:
   *         description: Invalid request body
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: Agent or session not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  messagesRouter.post('/', validateSessionMessage, handleValidationErrors, messageHandlers.createMessage)

  /**
   * @swagger
   * /agents/{agentId}/sessions/{sessionId}/messages/{messageId}:
   *   delete:
   *     summary: Delete a message from a session
   *     tags: [Messages]
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *         description: Session ID
   *       - in: path
   *         name: messageId
   *         required: true
   *         schema:
   *           type: integer
   *         description: Message ID
   *     responses:
   *       204:
   *         description: Message deleted successfully
   *       404:
   *         description: Agent, session, or message not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  messagesRouter.delete('/:messageId', validateSessionMessageId, handleValidationErrors, messageHandlers.deleteMessage)
  return messagesRouter
}

// Mount nested resources with clear hierarchy
const sessionsRouter = createSessionsRouter()
const messagesRouter = createMessagesRouter()

// Mount sessions under specific agent
agentsRouter.use('/:agentId/sessions', validateAgentId, checkAgentExists, handleValidationErrors, sessionsRouter)

// Mount messages under specific agent/session
agentsRouter.use(
  '/:agentId/sessions/:sessionId/messages',
  validateAgentId,
  validateSessionId,
  handleValidationErrors,
  messagesRouter
)

// Export main router and convenience router
export const agentsRoutes = agentsRouter
