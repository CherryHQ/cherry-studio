import type { CreateAssistantDto, UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import type { Assistant, AssistantSettings } from '@shared/data/types/assistant'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { BookOpen, Settings, SlidersHorizontal, Wrench } from 'lucide-react'

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
    icon: SlidersHorizontal,
    labelKey: 'library.config.section.more.label',
    descKey: 'library.config.section.more.desc'
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
export const ASSISTANT_CONTEXT_COUNT_MIN = 1

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

const DEFAULT_CREATE_ASSISTANT_EMOJI = '💬'

function buildAssistantSettingsFromForm(
  form: AssistantFormState,
  baseSettings: AssistantSettings = DEFAULT_ASSISTANT_SETTINGS
): AssistantSettings {
  return {
    ...baseSettings,
    temperature: form.temperature,
    enableTemperature: form.enableTemperature,
    topP: form.topP,
    enableTopP: form.enableTopP,
    maxTokens: form.maxTokens,
    enableMaxTokens: form.enableMaxTokens,
    contextCount: normalizeContextCount(form.contextCount),
    streamOutput: form.streamOutput,
    toolUseMode: form.toolUseMode,
    maxToolCalls: form.maxToolCalls,
    enableMaxToolCalls: form.enableMaxToolCalls,
    customParameters: form.customParameters,
    mcpMode: form.mcpMode
  }
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
    contextCount: normalizeContextCount(settings.contextCount ?? UI_DEFAULT_CONTEXT_COUNT),
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

export function buildCreateAssistantFormState(): AssistantFormState {
  return {
    name: '',
    emoji: DEFAULT_CREATE_ASSISTANT_EMOJI,
    description: '',
    modelId: undefined,
    prompt: '',
    temperature: DEFAULT_ASSISTANT_SETTINGS.temperature,
    enableTemperature: DEFAULT_ASSISTANT_SETTINGS.enableTemperature,
    topP: DEFAULT_ASSISTANT_SETTINGS.topP,
    enableTopP: DEFAULT_ASSISTANT_SETTINGS.enableTopP,
    maxTokens: DEFAULT_ASSISTANT_SETTINGS.maxTokens,
    enableMaxTokens: DEFAULT_ASSISTANT_SETTINGS.enableMaxTokens,
    contextCount: DEFAULT_ASSISTANT_SETTINGS.contextCount,
    streamOutput: DEFAULT_ASSISTANT_SETTINGS.streamOutput,
    toolUseMode: DEFAULT_ASSISTANT_SETTINGS.toolUseMode,
    maxToolCalls: DEFAULT_ASSISTANT_SETTINGS.maxToolCalls,
    enableMaxToolCalls: DEFAULT_ASSISTANT_SETTINGS.enableMaxToolCalls,
    customParameters: DEFAULT_ASSISTANT_SETTINGS.customParameters,
    mcpMode: DEFAULT_ASSISTANT_SETTINGS.mcpMode,
    tags: [],
    knowledgeBaseIds: [],
    mcpServerIds: []
  }
}

export interface AssistantCreateValidation {
  nameMissing: boolean
  promptMissing: boolean
  isValid: boolean
}

export function validateAssistantCreateForm(form: AssistantFormState): AssistantCreateValidation {
  const nameMissing = form.name.trim() === ''
  const promptMissing = form.prompt.trim() === ''
  return {
    nameMissing,
    promptMissing,
    isValid: !nameMissing && !promptMissing
  }
}

export function isCreateAssistantPayloadValid(form: AssistantFormState): boolean {
  return validateAssistantCreateForm(form).isValid
}

export function buildCreateAssistantPayload(form: AssistantFormState): CreateAssistantDto {
  return {
    name: form.name.trim(),
    prompt: form.prompt,
    emoji: form.emoji,
    description: form.description,
    ...(form.modelId !== undefined ? { modelId: form.modelId } : {}),
    settings: buildAssistantSettingsFromForm(form, DEFAULT_ASSISTANT_SETTINGS),
    ...(form.knowledgeBaseIds.length > 0 ? { knowledgeBaseIds: form.knowledgeBaseIds } : {}),
    ...(form.mcpServerIds.length > 0 ? { mcpServerIds: form.mcpServerIds } : {})
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

export type AssistantSaveIntent =
  | {
      kind: 'create'
      payload: CreateAssistantDto
      tagNames: string[]
    }
  | {
      kind: 'update'
      payload: UpdateAssistantDto
      tagNames: string[]
      tagsChanged: boolean
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
          settings: buildAssistantSettingsFromForm(form, assistant.settings)
        }
      : {}),
    ...(knowledgeBaseIdsChanged ? { knowledgeBaseIds: form.knowledgeBaseIds } : {}),
    ...(mcpServerIdsChanged ? { mcpServerIds: form.mcpServerIds } : {})
  }

  return { dto, tagsChanged, tagNames: form.tags }
}

export function diffAssistantSaveIntent(
  form: AssistantFormState,
  baseline: AssistantFormState,
  assistant: Assistant | null
): AssistantSaveIntent | null {
  if (!assistant) {
    if (!isCreateAssistantPayloadValid(form)) {
      return null
    }
    return {
      kind: 'create',
      payload: buildCreateAssistantPayload(form),
      tagNames: form.tags
    }
  }

  const diff = diffAssistantUpdate(form, baseline, assistant)
  if (!diff) return null

  return {
    kind: 'update',
    payload: diff.dto,
    tagNames: diff.tagNames,
    tagsChanged: diff.tagsChanged
  }
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

function normalizeContextCount(value: number): number {
  if (!Number.isFinite(value)) return UI_DEFAULT_CONTEXT_COUNT
  return Math.max(ASSISTANT_CONTEXT_COUNT_MIN, Math.trunc(value))
}
