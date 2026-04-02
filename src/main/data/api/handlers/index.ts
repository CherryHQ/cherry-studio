/**
 * API Handlers Index
 *
 * Combines all domain-specific handlers into a unified apiHandlers object.
 * TypeScript will error if any endpoint from ApiSchemas is missing.
 *
 * Handler files are organized by domain:
 * - test.ts - Test API handlers
 * - topics.ts - Topic API handlers
 * - messages.ts - Message API handlers
 * - translate.ts - Translate API handlers
 */

import type { ApiImplementation } from '@shared/data/api/apiTypes'

import { fileProcessingHandlers } from './fileProcessing'
import { knowledgeHandlers } from './knowledges'
import { mcpServerHandlers } from './mcpServers'
import { messageHandlers } from './messages'
import { miniappHandlers } from './miniapps'
import { testHandlers } from './test'
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
  ...fileProcessingHandlers,
  ...testHandlers,
  ...topicHandlers,
  ...messageHandlers,
  ...knowledgeHandlers,
  ...translateHandlers,
  ...mcpServerHandlers,
  ...miniappHandlers
}
