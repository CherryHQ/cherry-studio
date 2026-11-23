import type { UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import type { Assistant, AssistantSettings } from '@shared/data/types/assistant'
import { AssistantSettingsSchema, DEFAULT_ASSISTANT_SETTINGS, McpModeSchema } from '@shared/data/types/assistant'
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
  enableBrowser: boolean
  mcpMode: AssistantSettings['mcpMode']
  // context management (P2-D assistant override). `contextOverrideEnabled` is
  // the master switch for the OFFLOAD + COMPRESSION fields only.
  contextOverrideEnabled: boolean
  contextCompressEnabled: boolean
  contextTruncateThreshold: number
  /**
   * Serve only the last N messages; null = unlimited. Independent of
   * `contextOverrideEnabled` — it decides how much history a request carries,
   * not what happens when the context overflows, and it persists on its own.
   */
  contextMaxMessages: number | null
  /**
   * Compact once the prompt passes this percent of the available input context.
   * null = inherit the global trigger — same three-state contract as
   * `contextMaxMessages`, so editing a sibling field never freezes an
   * inherited threshold at whatever the global happened to be.
   */
  contextCompressThresholdPercent: number | null
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
  const maxTokens = AssistantSettingsSchema.shape.maxTokens.safeParse(settings.maxTokens)
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
    maxTokens: maxTokens.success ? maxTokens.data : UI_DEFAULT_MAX_TOKENS,
    enableMaxTokens: settings.enableMaxTokens ?? false,
    streamOutput: settings.streamOutput ?? true,
    maxToolCalls: settings.maxToolCalls ?? DEFAULT_ASSISTANT_SETTINGS.maxToolCalls,
    enableMaxToolCalls: settings.enableMaxToolCalls ?? true,
    customParameters: settings.customParameters ?? [],
    enableBrowser: settings.enableBrowser ?? true,
    mcpMode: mcpMode.success ? mcpMode.data : DEFAULT_ASSISTANT_SETTINGS.mcpMode,
    // Only an offload/compression field means "override": a lone maxMessages is
    // the scope control saved on its own.
    contextOverrideEnabled: ctx != null && (ctx.truncateThreshold !== undefined || ctx.compress !== undefined),
    contextCompressEnabled: ctx?.compress?.enabled ?? DEFAULT_CONTEXT_SETTINGS.compress.enabled,
    contextTruncateThreshold: ctx?.truncateThreshold ?? DEFAULT_CONTEXT_SETTINGS.truncateThreshold,
    contextMaxMessages: ctx?.maxMessages ?? null,
    contextCompressThresholdPercent: ctx?.compress?.thresholdPercent ?? null,
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
 * - Columns and settings carry only the keys that changed. The service merges
 *   a partial `settings` object onto the stored value, so untouched historical
 *   settings are neither revalidated nor overwritten.
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
  const maxTokensChanged = baseline.maxTokens !== form.maxTokens
  const enableMaxTokensChanged = baseline.enableMaxTokens !== form.enableMaxTokens

  const contextSettingsChanged =
    baseline.contextOverrideEnabled !== form.contextOverrideEnabled ||
    // Always compared: the scope control persists whether or not the
    // offload/compression override is on.
    baseline.contextMaxMessages !== form.contextMaxMessages ||
    // Sub-fields only matter while the override is on, so an ON→OFF→ON round
    // trip that lands back on the baseline values fires no spurious PATCH.
    (form.contextOverrideEnabled &&
      (baseline.contextCompressEnabled !== form.contextCompressEnabled ||
        baseline.contextTruncateThreshold !== form.contextTruncateThreshold ||
        baseline.contextCompressThresholdPercent !== form.contextCompressThresholdPercent ||
        baseline.contextCompressModelId !== form.contextCompressModelId))

  const settings: NonNullable<UpdateAssistantDto['settings']> = {}

  if (baseline.temperature !== form.temperature) settings.temperature = form.temperature

  if (baseline.enableTemperature !== form.enableTemperature) settings.enableTemperature = form.enableTemperature

  if (baseline.topP !== form.topP) settings.topP = form.topP

  if (baseline.enableTopP !== form.enableTopP) settings.enableTopP = form.enableTopP

  if (maxTokensChanged || (enableMaxTokensChanged && form.enableMaxTokens)) settings.maxTokens = form.maxTokens

  if (enableMaxTokensChanged) settings.enableMaxTokens = form.enableMaxTokens

  if (baseline.streamOutput !== form.streamOutput) settings.streamOutput = form.streamOutput

  if (baseline.maxToolCalls !== form.maxToolCalls) settings.maxToolCalls = form.maxToolCalls

  if (baseline.enableMaxToolCalls !== form.enableMaxToolCalls) settings.enableMaxToolCalls = form.enableMaxToolCalls

  if (baseline.enableBrowser !== form.enableBrowser) settings.enableBrowser = form.enableBrowser

  if (baseline.mcpMode !== form.mcpMode) settings.mcpMode = form.mcpMode

  if (customParametersChanged) settings.customParameters = form.customParameters

  if (contextSettingsChanged) {
    if (form.contextOverrideEnabled) {
      const contextSettings: NonNullable<typeof settings.contextSettings> = {
        truncateThreshold: form.contextTruncateThreshold
      }

      if (form.contextMaxMessages !== null) contextSettings.maxMessages = form.contextMaxMessages

      const compress: NonNullable<typeof contextSettings.compress> = {
        enabled: form.contextCompressEnabled,
        modelId: form.contextCompressModelId
      }

      if (form.contextCompressThresholdPercent !== null)
        compress.thresholdPercent = form.contextCompressThresholdPercent
      contextSettings.compress = compress
      settings.contextSettings = contextSettings
    } else {
      // null clears the override; an absent limit continues to follow the global value.
      settings.contextSettings = form.contextMaxMessages !== null ? { maxMessages: form.contextMaxMessages } : null
    }
  }

  const nameChanged = baseline.name !== form.name
  const emojiChanged = baseline.emoji !== form.emoji
  const descriptionChanged = baseline.description !== form.description
  const modelIdChanged = baseline.modelId !== form.modelId
  const promptChanged = baseline.prompt !== form.prompt
  const settingsChanged = Object.keys(settings).length > 0

  const groupChanged = baseline.groupId !== form.groupId
  const knowledgeBaseIdsChanged = !sameIdSet(baseline.knowledgeBaseIds, form.knowledgeBaseIds)
  const mcpServerIdsChanged = !sameIdSet(baseline.mcpServerIds, form.mcpServerIds)

  if (
    !nameChanged &&
    !emojiChanged &&
    !descriptionChanged &&
    !modelIdChanged &&
    !promptChanged &&
    !settingsChanged &&
    !groupChanged &&
    !knowledgeBaseIdsChanged &&
    !mcpServerIdsChanged
  ) {
    return null
  }

  const dto: UpdateAssistantDto = {}

  if (nameChanged) dto.name = form.name.trim() || assistant.name

  if (emojiChanged) dto.emoji = form.emoji

  if (descriptionChanged) dto.description = form.description

  if (modelIdChanged) dto.modelId = form.modelId

  if (promptChanged) dto.prompt = form.prompt

  if (settingsChanged) dto.settings = settings

  if (knowledgeBaseIdsChanged) dto.knowledgeBaseIds = form.knowledgeBaseIds

  if (mcpServerIdsChanged) dto.mcpServerIds = form.mcpServerIds

  if (groupChanged) dto.groupId = form.groupId

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
