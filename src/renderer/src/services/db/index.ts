/**
 * Unified data access layer for messages
 * Provides a consistent API for accessing messages from different sources
 * (Dexie/IndexedDB for regular chats, IPC/Backend for agent sessions)
 */

// Export main service
export { DbService, dbService } from './DbService'

// Export types
export type { MessageDataSource, MessageExchange } from './types'
export {
  buildAgentSessionTopicId,
  extractSessionId,
  isAgentSessionTopicId
} from './types'

// Export implementations (for testing or direct access if needed)
export { AgentMessageDataSource } from './AgentMessageDataSource'
export { DexieMessageDataSource } from './DexieMessageDataSource'
