/**
 * Schema Index - Composes all domain schemas into unified ApiSchemas
 *
 * This file has ONE responsibility: compose domain schemas into ApiSchemas.
 *
 * Import conventions (see api/README.md for details):
 * - Infrastructure types: import from '@shared/data/api'
 * - Domain DTOs: import directly from schema files (e.g., '@shared/data/api/schemas/topic')
 *
 * @example
 * ```typescript
 * // Infrastructure types via barrel export
 * import type { ApiSchemas, DataRequest } from '@shared/data/api'
 *
 * // Domain DTOs directly from schema files
 * import type { TestItem, CreateTestItemDto } from '@shared/data/api/schemas/test'
 * import type { Topic, CreateTopicDto } from '@shared/data/api/schemas/topics'
 * import type { Message, CreateMessageDto } from '@shared/data/api/schemas/messages'
 * ```
 */

import type { AssertValidSchemas } from '../apiTypes'
import type { KnowledgeSchemas } from './knowledge'
import type { MessageSchemas } from './messages'
import type { TestSchemas } from './test'
import type { TopicSchemas } from './topics'

/**
 * Merged API Schemas - single source of truth for all API endpoints
 *
 * All domain schemas are composed here using intersection types.
 * AssertValidSchemas provides compile-time validation:
 * - Invalid HTTP methods become `never` type
 * - Missing `response` field causes type errors
 *
 * When adding a new domain:
 * 1. Create the schema file (e.g., topic.ts)
 * 2. Import and add to intersection below
 */
export type ApiSchemas = AssertValidSchemas<TestSchemas & TopicSchemas & MessageSchemas & KnowledgeSchemas>
