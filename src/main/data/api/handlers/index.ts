/**
 * API Handlers Index
 *
 * Combines all domain-specific handlers into a unified apiHandlers object.
 * TypeScript will error if any endpoint from ApiSchemas is missing.
 *
 * Handler files are organized by domain:
 * - test.ts - Test API handlers
 *
 * @example Adding a new domain:
 * ```typescript
 * import { topicHandlers } from './topic'
 *
 * export const apiHandlers: ApiImplementation = {
 *   ...testHandlers,
 *   ...topicHandlers  // Add new domain handlers here
 * }
 * ```
 */

import type { ApiImplementation } from '@shared/data/api/apiTypes'

import { testHandlers } from './test'

/**
 * Complete API handlers implementation
 * Must implement every path+method combination from ApiSchemas
 *
 * Handlers are spread from individual domain modules for maintainability.
 * TypeScript ensures exhaustive coverage - missing handlers cause compile errors.
 */
export const apiHandlers: ApiImplementation = {
  ...testHandlers
}
