/**
 * Agent Services Module
 *
 * This module provides service classes for managing agents, sessions, and session logs.
 * All services extend BaseService and provide database operations with proper error handling.
 */

// Service classes
export { AgentService } from './AgentService'
export { SessionLogService } from './SessionLogService'
export { SessionService } from './SessionService'

// Service instances (singletons)
export { agentService } from './AgentService'
export { sessionLogService } from './SessionLogService'
export { sessionService } from './SessionService'

// Type definitions for service requests and responses
export type { CreateAgentRequest, ListAgentsOptions, UpdateAgentRequest } from './AgentService'
export type { CreateSessionLogRequest, ListSessionLogsOptions, UpdateSessionLogRequest } from './SessionLogService'
export type { CreateSessionRequest, ListSessionsOptions, UpdateSessionRequest } from './SessionService'
