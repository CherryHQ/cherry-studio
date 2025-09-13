/**
 * Agent Services Module
 *
 * This module provides service classes for managing agents, sessions, and session messages.
 * All services extend BaseService and provide database operations with proper error handling.
 */

// Service classes
export { AgentService } from './AgentService'
export { SessionMessageService } from './SessionMessageService'
export { SessionService } from './SessionService'

// Service instances (singletons)
export { agentService } from './AgentService'
export { sessionMessageService } from './SessionMessageService'
export { sessionService } from './SessionService'

// Type definitions for service requests and responses
export type { CreateAgentRequest, ListAgentsOptions, UpdateAgentRequest } from './AgentService'
export type {
  CreateSessionMessageRequest,
  ListSessionMessagesOptions,
  UpdateSessionMessageRequest
} from './SessionMessageService'
export type { CreateSessionRequest, ListSessionsOptions, UpdateSessionRequest } from './SessionService'
