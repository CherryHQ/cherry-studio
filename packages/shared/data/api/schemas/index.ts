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
 * import type { Topic, CreateTopicDto } from '@shared/data/api/schemas/topics'
 * import type { Message, CreateMessageDto } from '@shared/data/api/schemas/messages'
 * import type { TranslateHistory, CreateTranslateHistoryDto } from '@shared/data/api/schemas/translate'
 * ```
 */

import type { AssertValidSchemas } from '../apiTypes'
import type { AgentChannelSchemas } from './agentChannels'
import type { AgentSchemas } from './agents'
import type { AssistantSchemas } from './assistants'
import type { GroupSchemas } from './groups'
import type { KnowledgeSchemas } from './knowledges'
import type { MCPServerSchemas } from './mcpServers'
import type { MessageSchemas } from './messages'
import type { MiniAppSchemas } from './miniApps'
import type { ModelSchemas } from './models'
import type { PaintingsSchemas } from './paintings'
import type { PinSchemas } from './pins'
import type { PromptSchemas } from './prompts'
import type { ProviderSchemas } from './providers'
import type { TagSchemas } from './tags'
import type { TemporaryChatSchemas } from './temporaryChats'
import type { TopicSchemas } from './topics'
import type { TranslateSchemas } from './translate'

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
export type ApiSchemas = AssertValidSchemas<
  TopicSchemas &
    MessageSchemas &
    TemporaryChatSchemas &
    ModelSchemas &
    ProviderSchemas &
    PaintingsSchemas &
    TranslateSchemas &
    MCPServerSchemas &
    KnowledgeSchemas &
    MiniAppSchemas &
    AssistantSchemas &
    TagSchemas &
    PromptSchemas &
    GroupSchemas &
    PinSchemas &
    AgentSchemas &
    AgentChannelSchemas
>
