import type { UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import type { Assistant, AssistantSettings } from '@shared/data/types/assistant'
import { BookOpen, FileText, Settings, Wrench } from 'lucide-react'

import type { SectionDescriptor } from '../ConfigEditorShell'

// ---------------------------------------------------------------------------
// Section metadata
// ---------------------------------------------------------------------------

export type AssistantConfigSection = 'basic' | 'prompt' | 'knowledge' | 'tools'

export const ASSISTANT_CONFIG_SECTIONS: readonly SectionDescriptor<AssistantConfigSection>[] = [
  {
    id: 'basic',
    icon: Settings,
    labelKey: 'library.config.section.basic.label',
    descKey: 'library.config.section.basic.desc'
  },
  {
    id: 'prompt',
    icon: FileText,
    labelKey: 'library.config.section.prompt.label',
    descKey: 'library.config.section.prompt.desc'
  },
  {
    id: 'knowledge',
    icon: BookOpen,
    labelKey: 'library.config.section.knowledge.label',
    descKey: 'library.config.section.knowledge.desc'
  },
  {
    id: 'tools',
    icon: Wrench,
    labelKey: 'library.config.section.tools.label',
    descKey: 'library.config.section.tools.desc'
  }
]

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
const UI_DEFAULT_CONTEXT_COUNT = 5
const UI_DEFAULT_MAX_TOOL_CALLS = 20

/**
 * Flat form state shared by all four Assistant editor sections. Every
 * editable field lives here so the editor commits in a single PATCH;
 * section components read a subset and call `onChange(patch)` to write
 * back.
 *
 * `tags` stores user-facing names, not ids — tag-id resolution happens
 * at save time via `ensureTags` so the user can freely type new tags
 * without paying a network round-trip per keystroke.
 */
export interface AssistantFormState {
  // columns
  name: string
  emoji: string
  description: string
  modelId: Assistant['modelId']
  prompt: string
  // settings (flattened from assistant.settings)
  temperature: number
  /** When false, temperature is omitted from the LLM request (model default). */
  enableTemperature: boolean
  topP: number
  enableTopP: boolean
  maxTokens: number
  enableMaxTokens: boolean
  contextCount: number
  streamOutput: boolean
  toolUseMode: 'function' | 'prompt'
  maxToolCalls: number
  enableMaxToolCalls: boolean
  customParameters: CustomParameter[]
  mcpMode: AssistantSettings['mcpMode']
  // relations
  tags: string[]
  knowledgeBaseIds: string[]
  mcpServerIds: string[]
}

export function initialAssistantFormState(assistant: Assistant): AssistantFormState {
  const settings = assistant.settings ?? ({} as AssistantSettings)
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
    contextCount: settings.contextCount ?? UI_DEFAULT_CONTEXT_COUNT,
    streamOutput: settings.streamOutput ?? true,
    toolUseMode: settings.toolUseMode ?? 'function',
    maxToolCalls: settings.maxToolCalls ?? UI_DEFAULT_MAX_TOOL_CALLS,
    enableMaxToolCalls: settings.enableMaxToolCalls ?? true,
    customParameters: settings.customParameters ?? [],
    mcpMode: settings.mcpMode ?? 'auto',
    tags: (assistant.tags ?? []).map((t) => t.name),
    knowledgeBaseIds: assistant.knowledgeBaseIds ?? [],
    mcpServerIds: assistant.mcpServerIds ?? []
  }
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * Result of `diffAssistantUpdate`.
 *
 * `dto` is the PATCH body sans `tagIds` — tag resolution is a side
 * effect (`ensureTags` may POST new rows) so it stays at the page
 * level. `tagsChanged` + `tagNames` tell the page whether to call
 * `ensureTags` and what to resolve.
 */
export interface AssistantDiffResult {
  dto: UpdateAssistantDto
  tagsChanged: boolean
  tagNames: string[]
}

/**
 * Compute the minimal Assistant PATCH payload + side-effect hints.
 *
 * - Columns block: when ANY of name/emoji/description/modelId/prompt
 *   or any settings field differs, the dto carries all five column
 *   keys + a full `settings` object spread over `assistant.settings`
 *   (preserves unrelated settings keys the UI doesn't surface).
 * - Relation arrays (knowledgeBaseIds / mcpServerIds) ship only when
 *   their set differs — order-insensitive, matches junction semantics.
 * - Tags: NOT placed on the dto here; `tagsChanged` + `tagNames`
 *   let the page decide whether to `ensureTags` and attach `tagIds`.
 *
 * Returns `null` when nothing changed.
 */
export function diffAssistantUpdate(
  form: AssistantFormState,
  baseline: AssistantFormState,
  assistant: Assistant
): AssistantDiffResult | null {
  const customParametersChanged = JSON.stringify(baseline.customParameters) !== JSON.stringify(form.customParameters)

  const columnsChanged =
    baseline.name !== form.name ||
    baseline.emoji !== form.emoji ||
    baseline.description !== form.description ||
    baseline.modelId !== form.modelId ||
    baseline.prompt !== form.prompt ||
    baseline.temperature !== form.temperature ||
    baseline.enableTemperature !== form.enableTemperature ||
    baseline.topP !== form.topP ||
    baseline.enableTopP !== form.enableTopP ||
    baseline.maxTokens !== form.maxTokens ||
    baseline.enableMaxTokens !== form.enableMaxTokens ||
    baseline.contextCount !== form.contextCount ||
    baseline.streamOutput !== form.streamOutput ||
    baseline.toolUseMode !== form.toolUseMode ||
    baseline.maxToolCalls !== form.maxToolCalls ||
    baseline.enableMaxToolCalls !== form.enableMaxToolCalls ||
    baseline.mcpMode !== form.mcpMode ||
    customParametersChanged

  const tagsChanged = !sameStringSet(baseline.tags, form.tags)
  const knowledgeBaseIdsChanged = !sameIdSet(baseline.knowledgeBaseIds, form.knowledgeBaseIds)
  const mcpServerIdsChanged = !sameIdSet(baseline.mcpServerIds, form.mcpServerIds)

  if (!columnsChanged && !tagsChanged && !knowledgeBaseIdsChanged && !mcpServerIdsChanged) {
    return null
  }

  const dto: UpdateAssistantDto = {
    ...(columnsChanged
      ? {
          name: form.name.trim() || assistant.name,
          emoji: form.emoji,
          description: form.description,
          modelId: form.modelId,
          prompt: form.prompt,
          settings: {
            ...assistant.settings,
            temperature: form.temperature,
            enableTemperature: form.enableTemperature,
            topP: form.topP,
            enableTopP: form.enableTopP,
            maxTokens: form.maxTokens,
            enableMaxTokens: form.enableMaxTokens,
            contextCount: form.contextCount,
            streamOutput: form.streamOutput,
            toolUseMode: form.toolUseMode,
            maxToolCalls: form.maxToolCalls,
            enableMaxToolCalls: form.enableMaxToolCalls,
            customParameters: form.customParameters,
            mcpMode: form.mcpMode
          }
        }
      : {}),
    ...(knowledgeBaseIdsChanged ? { knowledgeBaseIds: form.knowledgeBaseIds } : {}),
    ...(mcpServerIdsChanged ? { mcpServerIds: form.mcpServerIds } : {})
  }

  return { dto, tagsChanged, tagNames: form.tags }
}

/** Order-insensitive id-set equality; junction tables don't carry ordering. */
function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((v) => set.has(v))
}
