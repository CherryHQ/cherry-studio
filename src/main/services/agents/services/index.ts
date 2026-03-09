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

// Agent service registry
export { agentServiceRegistry } from './AgentServiceRegistry'

// Register agent services
import { agentServiceRegistry } from './AgentServiceRegistry'
import ClaudeCodeService from './claudecode'

agentServiceRegistry.register('claude-code', new ClaudeCodeService())

// Type definitions for service requests and responses
export type { AgentEntity, AgentSessionEntity, CreateAgentRequest, UpdateAgentRequest } from '@types'
export type {
  AgentSessionMessageEntity,
  CreateSessionRequest,
  GetAgentSessionResponse,
  ListOptions as SessionListOptions,
  UpdateSessionRequest
} from '@types'
