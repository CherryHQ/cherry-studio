import type { UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
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
const UI_DEFAULT_MAX_TOOL_CALLS = 20

/**
 * Flat form state for the Assistant edit dialog. Every editable field lives
 * here so the dialog commits in a single PATCH.
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
    streamOutput: form.streamOutput,
    maxToolCalls: form.maxToolCalls,
    enableMaxToolCalls: form.enableMaxToolCalls,
    customParameters: form.customParameters,
    mcpMode: form.mcpMode,
    // null = clear the override (inherit globals). The `enabled` kill-switch
    // is deliberately not written here — it stays a global/topic-layer concern.
    contextSettings: form.contextOverrideEnabled
      ? {
          truncateThreshold: form.contextTruncateThreshold,
          compress: { enabled: form.contextCompressEnabled, modelId: form.contextCompressModelId }
        }
      : null
  }
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
    maxToolCalls: settings.maxToolCalls ?? UI_DEFAULT_MAX_TOOL_CALLS,
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

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * Result of `diffAssistantUpdate`.
 *
 * `dto` is the complete PATCH body, including `groupId` when the assignment
 * changes.
 */
export interface AssistantDiffResult {
  dto: UpdateAssistantDto
}

export type AssistantSaveIntent = {
  kind: 'update'
  payload: UpdateAssistantDto
}

/**
 * Compute the minimal Assistant PATCH payload.
 *
 * - Columns block: when ANY of name/emoji/description/modelId/prompt
 *   or any settings field differs, the dto carries all five column
 *   keys + a full `settings` object spread over `assistant.settings`
 *   (preserves unrelated settings keys the UI doesn't surface).
 * - Relation arrays (knowledgeBaseIds / mcpServerIds) ship only when
 *   their set differs — order-insensitive, matches junction semantics.
 * - Group: placed directly on the DTO as the canonical `groupId`.
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
    baseline.streamOutput !== form.streamOutput ||
    baseline.maxToolCalls !== form.maxToolCalls ||
    baseline.enableMaxToolCalls !== form.enableMaxToolCalls ||
    baseline.mcpMode !== form.mcpMode ||
    baseline.contextOverrideEnabled !== form.contextOverrideEnabled ||
    // Sub-fields only matter while the override is on, so an ON→OFF→ON round
    // trip that lands back on the baseline values fires no spurious PATCH.
    (form.contextOverrideEnabled &&
      (baseline.contextCompressEnabled !== form.contextCompressEnabled ||
        baseline.contextTruncateThreshold !== form.contextTruncateThreshold ||
        baseline.contextCompressModelId !== form.contextCompressModelId)) ||
    customParametersChanged

  const groupChanged = baseline.groupId !== form.groupId
  const knowledgeBaseIdsChanged = !sameIdSet(baseline.knowledgeBaseIds, form.knowledgeBaseIds)
  const mcpServerIdsChanged = !sameIdSet(baseline.mcpServerIds, form.mcpServerIds)

  if (!columnsChanged && !groupChanged && !knowledgeBaseIdsChanged && !mcpServerIdsChanged) {
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
    ...(mcpServerIdsChanged ? { mcpServerIds: form.mcpServerIds } : {}),
    ...(groupChanged ? { groupId: form.groupId } : {})
  }

  return { dto }
}

export function diffAssistantSaveIntent(
  form: AssistantFormState,
  baseline: AssistantFormState,
  assistant: Assistant
): AssistantSaveIntent | null {
  const diff = diffAssistantUpdate(form, baseline, assistant)
  if (!diff) return null

  return {
    kind: 'update',
    payload: diff.dto
  }
}

/** Order-insensitive id-set equality; junction tables don't carry ordering. */
function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}
