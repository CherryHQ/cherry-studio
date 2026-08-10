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
  // is the "自定义/customize" master switch for the OFFLOAD + COMPRESSION
  // settings: false → those inherit the globals; true → the fields below form
  // the override object.
  contextOverrideEnabled: boolean
  contextCompressEnabled: boolean
  contextTruncateThreshold: number
  /**
   * Serve only the last N messages; null = unlimited. Independent of
   * `contextOverrideEnabled` — it decides how much history a request carries,
   * not what happens when the context overflows, and it persists on its own.
   */
  contextMaxMessages: number | null
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
    // is deliberately not written here — it stays a global-layer concern.
    //
    // An empty limit is written as ABSENT (inherit), never as an explicit null:
    // the field's placeholder names the inherited global, so "empty" reads as
    // "follow global" in the UI and must mean the same thing in storage. The
    // schema can still carry an explicit null (see ContextSettingsOverride) —
    // no assistant-level control produces one today. maxMessages rides the same
    // object but is independent of the override switch, so it must survive when
    // only it is set.
    contextSettings: form.contextOverrideEnabled
      ? {
          truncateThreshold: form.contextTruncateThreshold,
          ...(form.contextMaxMessages !== null ? { maxMessages: form.contextMaxMessages } : {}),
          compress: { enabled: form.contextCompressEnabled, modelId: form.contextCompressModelId }
        }
      : form.contextMaxMessages !== null
        ? { maxMessages: form.contextMaxMessages }
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
    maxToolCalls: settings.maxToolCalls ?? DEFAULT_ASSISTANT_SETTINGS.maxToolCalls,
    enableMaxToolCalls: settings.enableMaxToolCalls ?? true,
    customParameters: settings.customParameters ?? [],
    mcpMode: mcpMode.success ? mcpMode.data : DEFAULT_ASSISTANT_SETTINGS.mcpMode,
    // Override is on only when an offload/compression field is stored — a
    // contextSettings carrying nothing but maxMessages is the scope control
    // saved on its own, not a customization of the globals.
    contextOverrideEnabled: ctx != null && (ctx.truncateThreshold !== undefined || ctx.compress !== undefined),
    contextCompressEnabled: ctx?.compress?.enabled ?? DEFAULT_CONTEXT_SETTINGS.compress.enabled,
    contextTruncateThreshold: ctx?.truncateThreshold ?? DEFAULT_CONTEXT_SETTINGS.truncateThreshold,
    contextMaxMessages: ctx?.maxMessages ?? null,
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
    // Always compared: the scope control persists whether or not the
    // offload/compression override is on.
    baseline.contextMaxMessages !== form.contextMaxMessages ||
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
