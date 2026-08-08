import type { Assistant, AssistantSettings } from '@shared/data/types/assistant'
import { DEFAULT_ASSISTANT_SETTINGS, McpModeSchema } from '@shared/data/types/assistant'
import { DEFAULT_CONTEXT_SETTINGS } from '@shared/data/types/contextSettings'

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

type CustomParameter = AssistantSettings['customParameters'][number]

// Fallbacks applied only when the backend row doesn't have a value — mirrors
// original AssistantModelSettings defaults. `enable*` is false by default
// (matches DEFAULT_ASSISTANT_SETTINGS): the sampling parameter is NOT sent to
// the LLM unless the user explicitly opts in.
const UI_DEFAULT_TEMPERATURE = 1.0
const UI_DEFAULT_TOP_P = 1
const UI_DEFAULT_MAX_TOKENS = 4096

/**
 * Flat draft state for the Assistant edit dialog. Every editable field lives
 * here; each control persists its own field.
 *
 * `groupId` stores the canonical assistant group reference. Names are resolved
 * only for display by the selector.
 */
export interface AssistantFormState {
  // columns
  name: string
  emoji: string
  description: string
  modelId: Assistant['modelId'] | undefined
  prompt: string
  // settings (flattened from assistant.settings)
  temperature: number
  /** When false, temperature is omitted from the LLM request (model default). */
  enableTemperature: boolean
  topP: number
  enableTopP: boolean
  maxTokens: number
  enableMaxTokens: boolean
  streamOutput: boolean
  maxToolCalls: number
  enableMaxToolCalls: boolean
  customParameters: CustomParameter[]
  mcpMode: AssistantSettings['mcpMode']
  // context management (P2-D assistant override). `contextOverrideEnabled`
  // is the "自定义/customize" master switch: false → settings.contextSettings
  // is written as null (inherit globals); true → the three fields below form
  // the override object.
  contextOverrideEnabled: boolean
  contextCompressEnabled: boolean
  contextTruncateThreshold: number
  /** null = no explicit pick (follow the global / current model). */
  contextCompressModelId: string | null
  // relations
  groupId: string | null
  knowledgeBaseIds: string[]
  mcpServerIds: string[]
}

export function initialAssistantFormState(assistant: Assistant): AssistantFormState {
  const settings = assistant.settings ?? ({} as AssistantSettings)
  const mcpMode = McpModeSchema.safeParse(settings.mcpMode)
  const ctx = settings.contextSettings
  return {
    name: assistant.name,
    emoji: assistant.emoji,
    description: assistant.description,
    modelId: assistant.modelId,
    prompt: assistant.prompt ?? '',
    temperature: settings.temperature ?? UI_DEFAULT_TEMPERATURE,
    enableTemperature: settings.enableTemperature ?? false,
    topP: settings.topP ?? UI_DEFAULT_TOP_P,
    enableTopP: settings.enableTopP ?? false,
    maxTokens: settings.maxTokens ?? UI_DEFAULT_MAX_TOKENS,
    enableMaxTokens: settings.enableMaxTokens ?? false,
    streamOutput: settings.streamOutput ?? true,
    maxToolCalls: settings.maxToolCalls ?? DEFAULT_ASSISTANT_SETTINGS.maxToolCalls,
    enableMaxToolCalls: settings.enableMaxToolCalls ?? true,
    customParameters: settings.customParameters ?? [],
    mcpMode: mcpMode.success ? mcpMode.data : DEFAULT_ASSISTANT_SETTINGS.mcpMode,
    // null/absent contextSettings → override off; show the global defaults as
    // placeholders (the section seeds live global values on toggle-on).
    contextOverrideEnabled: ctx != null,
    contextCompressEnabled: ctx?.compress?.enabled ?? DEFAULT_CONTEXT_SETTINGS.compress.enabled,
    contextTruncateThreshold: ctx?.truncateThreshold ?? DEFAULT_CONTEXT_SETTINGS.truncateThreshold,
    contextCompressModelId: ctx?.compress?.modelId ?? null,
    groupId: assistant.groupId,
    knowledgeBaseIds: assistant.knowledgeBaseIds ?? [],
    mcpServerIds: assistant.mcpServerIds ?? []
  }
}
