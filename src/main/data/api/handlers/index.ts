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
 */

import type { ApiImplementation } from '@shared/data/api/apiTypes'

import { knowledgeHandlers } from './knowledges'
import { messageHandlers } from './messages'
import { testHandlers } from './test'
import { topicHandlers } from './topics'

/**
 * Complete API handlers implementation
 * Must implement every path+method combination from ApiSchemas
 *
 * Handlers are spread from individual domain modules for maintainability.
 * TypeScript ensures exhaustive coverage - missing handlers cause compile errors.
 */
export const apiHandlers: ApiImplementation = {
  ...testHandlers,
  ...topicHandlers,
  ...messageHandlers,
  ...knowledgeHandlers
}
