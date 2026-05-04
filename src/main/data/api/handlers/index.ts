/**
 * API Handlers Index
 *
 * Combines all domain-specific handlers into a unified apiHandlers object.
 * TypeScript will error if any endpoint from ApiSchemas is missing.
 *
 * Handler files are organized by domain:
 * - topics.ts - Topic API handlers
 * - messages.ts - Message API handlers
 * - models.ts - Model API handlers
 * - providers.ts - Provider API handlers
 * - translate.ts - Translate API handlers
 */

import type { ApiImplementation } from '@shared/data/api/apiTypes'

import { agentChannelHandlers } from './agentChannels'
import { agentHandlers } from './agents'
import { assistantHandlers } from './assistants'
import { groupHandlers } from './groups'
import { knowledgeHandlers } from './knowledges'
import { mcpServerHandlers } from './mcpServers'
import { messageHandlers } from './messages'
import { miniappHandlers } from './miniapps'
import { modelHandlers } from './models'
import { pinHandlers } from './pins'
import { providerHandlers } from './providers'
import { tagHandlers } from './tags'
import { temporaryChatHandlers } from './temporaryChats'
import { topicHandlers } from './topics'
import { translateHandlers } from './translate'

/**
 * Complete API handlers implementation
 * Must implement every path+method combination from ApiSchemas
 *
 * Handlers are spread from individual domain modules for maintainability.
 * TypeScript ensures exhaustive coverage - missing handlers cause compile errors.
 */
export const apiHandlers: ApiImplementation = {
  ...agentHandlers,
  ...assistantHandlers,
  ...agentChannelHandlers,
  ...topicHandlers,
  ...messageHandlers,
  ...temporaryChatHandlers,
  ...modelHandlers,
  ...providerHandlers,
  ...knowledgeHandlers,
  ...translateHandlers,
  ...mcpServerHandlers,
  ...miniappHandlers,
  ...tagHandlers,
  ...groupHandlers,
  ...pinHandlers
}
