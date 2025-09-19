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
  validateSessionReplace,
  validateSessionUpdate
} from './validators'

// Create main agents router
const agentsRouter = express.Router()

/**
 * @swagger
 * components:
 *   schemas:
 *     AgentEntity:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique agent identifier
 *         name:
 *           type: string
 *           description: Agent name
 *         description:
 *           type: string
 *           description: Agent description
 *         avatar:
 *           type: string
 *           description: Agent avatar URL
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
 *         built_in_tools:
 *           type: array
 *           items:
 *             type: string
 *           description: Built-in tool IDs
 *         mcps:
 *           type: array
 *           items:
 *             type: string
 *           description: MCP tool IDs
 *         knowledges:
 *           type: array
 *           items:
 *             type: string
 *           description: Knowledge base IDs
 *         configuration:
 *           type: object
 *           description: Extensible settings
 *         accessible_paths:
 *           type: array
 *           items:
 *             type: string
 *           description: Accessible directory paths
 *         permission_mode:
 *           type: string
 *           enum: [readOnly, acceptEdits, bypassPermissions]
 *           description: Permission mode
 *         max_steps:
 *           type: integer
 *           description: Maximum steps the agent can take
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *       required:
 *         - id
 *         - name
 *         - model
 *         - created_at
 *         - updated_at
 *     CreateAgentRequest:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           description: Agent name
 *         description:
 *           type: string
 *           description: Agent description
 *         avatar:
 *           type: string
 *           description: Agent avatar URL
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
 *         built_in_tools:
 *           type: array
 *           items:
 *             type: string
 *           description: Built-in tool IDs
 *         mcps:
 *           type: array
 *           items:
 *             type: string
 *           description: MCP tool IDs
 *         knowledges:
 *           type: array
 *           items:
 *             type: string
 *           description: Knowledge base IDs
 *         configuration:
 *           type: object
 *           description: Extensible settings
 *         accessible_paths:
 *           type: array
 *           items:
 *             type: string
 *           description: Accessible directory paths
 *         permission_mode:
 *           type: string
 *           enum: [readOnly, acceptEdits, bypassPermissions]
 *           description: Permission mode
 *         max_steps:
 *           type: integer
 *           description: Maximum steps the agent can take
 *       required:
 *         - name
 *         - model
 */

// Agent CRUD routes
agentsRouter.post('/', validateAgent, handleValidationErrors, agentHandlers.createAgent)
agentsRouter.get('/', validatePagination, handleValidationErrors, agentHandlers.listAgents)
agentsRouter.get('/:agentId', validateAgentId, handleValidationErrors, agentHandlers.getAgent)
agentsRouter.put(
  '/:agentId',
  validateAgentId,
  validateAgentReplace,
  handleValidationErrors,
  agentHandlers.updateAgent
)
agentsRouter.patch('/:agentId', validateAgentId, validateAgentUpdate, handleValidationErrors, agentHandlers.patchAgent)
agentsRouter.delete('/:agentId', validateAgentId, handleValidationErrors, agentHandlers.deleteAgent)

// Create sessions router with agent context
const createSessionsRouter = (): express.Router => {
  const sessionsRouter = express.Router({ mergeParams: true })

  // Session CRUD routes (nested under agent)
  sessionsRouter.post('/', validateSession, handleValidationErrors, sessionHandlers.createSession)
  sessionsRouter.get('/', validatePagination, handleValidationErrors, sessionHandlers.listSessions)
  sessionsRouter.get('/:sessionId', validateSessionId, handleValidationErrors, sessionHandlers.getSession)
  sessionsRouter.put(
    '/:sessionId',
    validateSessionId,
    validateSessionReplace,
    handleValidationErrors,
    sessionHandlers.updateSession
  )
  sessionsRouter.patch(
    '/:sessionId',
    validateSessionId,
    validateSessionUpdate,
    handleValidationErrors,
    sessionHandlers.patchSession
  )
  sessionsRouter.delete('/:sessionId', validateSessionId, handleValidationErrors, sessionHandlers.deleteSession)

  return sessionsRouter
}

// Create messages router with agent and session context
const createMessagesRouter = (): express.Router => {
  const messagesRouter = express.Router({ mergeParams: true })

  // Message CRUD routes (nested under agent/session)
  messagesRouter.post('/', validateSessionMessage, handleValidationErrors, messageHandlers.createMessage)
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
