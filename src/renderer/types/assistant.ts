import type {
  Assistant as DataApiAssistant,
  AssistantSettings as DataApiAssistantSettings,
  McpMode as DataApiMcpMode
} from '@shared/data/types/assistant'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { TranslateLanguage } from '@shared/data/types/translate'

import type { KnowledgeBase } from './knowledge'
import type { Model } from './model'
import type { Topic } from './topic'

export type Assistant = DataApiAssistant
export type AssistantSettings = DataApiAssistantSettings
export type McpMode = DataApiMcpMode

export interface QuickPhrase {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
  order?: number
}

/**
 * @deprecated removed in v2
 */
export type LegacyAssistantSettings = AssistantSettings & {
  contextCount?: number
  /** v1-only: tool-call mode (`function` | `prompt`). Removed from v2 AssistantSettings;
   *  retained here solely so the deprecated store migrations in `store/migrate.ts` compile. */
  toolUseMode?: 'function' | 'prompt'
}

/**
 * @deprecated removed in v2
 */
export type LegacyAssistant = {
  id: string
  name: string
  prompt: string
  knowledge_bases?: KnowledgeBase[]
  topics: Topic[]
  type: string
  group?: string[]
  emoji?: string
  description?: string
  model?: Model
  defaultModel?: Model
  settings?: Partial<LegacyAssistantSettings> & {
    /** legacy: only present in v1 settings */
    defaultModel?: Model
  }
  messages?: AssistantMessage[]
  enableWebSearch?: boolean
  // enableUrlContext is a Gemini/Anthropic-specific feature
  enableUrlContext?: boolean
  enableGenerateImage?: boolean
  /** MCP mode: 'disabled' (no MCP), 'auto' (hub server only), 'manual' (user selects servers) */
  mcpMode?: McpMode
  mcpServers?: McpServer[]
  knowledgeRecognition?: 'off' | 'on'
  regularPhrases?: QuickPhrase[] // Added for regular phrase
  tags?: string[] // assistant tags
  // for translate. A cleaner design would define a base assistant and make Assistant a union of
  // its variants, but the refactor cost is too high.
  content?: string
  targetLanguage?: TranslateLanguage
}

export type AssistantMessage = {
  role: 'user' | 'assistant'
  content: string
}
