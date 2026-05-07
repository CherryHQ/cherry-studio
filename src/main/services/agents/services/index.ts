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
export { TaskService } from './TaskService'

// Service instances (singletons)
export { agentService } from './AgentService'
export { schedulerService } from './SchedulerService'
export { sessionMessageService } from './SessionMessageService'
export { sessionService } from './SessionService'
export { taskService } from './TaskService'

// Type definitions for service requests and responses
export type { AgentEntity, AgentSessionEntity, CreateAgentRequest, UpdateAgentRequest } from '@types'
export type {
  AgentSessionMessageEntity,
  CreateSessionRequest,
  GetAgentSessionResponse,
  ListOptions as SessionListOptions,
  UpdateSessionRequest
} from '@types'
