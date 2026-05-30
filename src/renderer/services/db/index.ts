/**
 * @deprecated Scheduled for removal in v2.0.0
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING (by 0xfullex)
 * --------------------------------------------------------------------------
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 * Only critical bug fixes are accepted during this migration phase.
 *
 * This file is being refactored to v2 standards.
 * Any non-critical changes will conflict with the ongoing work.
 *
 * 🔗 Context & Status:
 * - Contribution Hold: https://github.com/CherryHQ/cherry-studio/issues/10954
 * - v2 Refactor PR   : https://github.com/CherryHQ/cherry-studio/pull/10162
 * --------------------------------------------------------------------------
 */
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
