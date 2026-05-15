/**
 * Shared helpers for resolving models and siblings groups, reused by any
 * `ChatContextProvider` that needs multi-model / regenerate semantics.
 */

import { application } from '@application'
import { assistantDataService } from '@data/services/AssistantService'
import { messageService } from '@main/data/services/MessageService'
import { modelService } from '@main/data/services/ModelService'
import {
  DEFAULT_ASSISTANT_CONTEXT_COUNT,
  type DefaultAssistantPreference
} from '@shared/data/preference/preferenceTypes'
import { type Assistant, DEFAULT_ASSISTANT_ID, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

// Monotonic counter so two regenerate clicks within the same millisecond
// don't collide on `Date.now()` and get treated as one sibling group. The
// counter resets per process — that's fine because the value only needs to
// be unique within an open chat session.
let siblingsGroupCounter = 0
function nextSiblingsGroupId(): number {
  siblingsGroupCounter = (siblingsGroupCounter + 1) % 1000
  return Date.now() * 1000 + siblingsGroupCounter
}

const DEFAULT_ASSISTANT_TIMESTAMP = new Date(0).toISOString()

function composeDefaultAssistant(
  modelId: UniqueModelId,
  overrides: DefaultAssistantPreference | null | undefined
): Assistant {
  const settings = {
    ...DEFAULT_ASSISTANT_SETTINGS,
    contextCount: DEFAULT_ASSISTANT_CONTEXT_COUNT,
    ...overrides?.settings
  }

  return {
    id: DEFAULT_ASSISTANT_ID,
    name: overrides?.name ?? 'Default Assistant',
    emoji: overrides?.emoji ?? '😀',
    prompt: overrides?.prompt ?? '',
    description: '',
    settings,
    modelId,
    modelName: null,
    mcpServerIds: [],
    knowledgeBaseIds: [],
    tags: [],
    createdAt: DEFAULT_ASSISTANT_TIMESTAMP,
    updatedAt: DEFAULT_ASSISTANT_TIMESTAMP
  }
}

function resolveContextCount(assistant: Assistant | undefined): number | undefined {
  const raw = (assistant?.settings as { contextCount?: unknown } | undefined)?.contextCount
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  return Math.max(0, Math.floor(raw))
}

export function limitHistoryByAssistantContext<T>(history: T[], assistant: Assistant | undefined): T[] {
  const contextCount = resolveContextCount(assistant)
  if (contextCount === undefined) return history
  return history.slice(-(contextCount + 1))
}

/** Resolve the Model list from an optional `@mentioned` list, falling back to the assistant default. */
export async function resolveModels(
  mentionedModelIds: UniqueModelId[] | undefined,
  defaultModelId: UniqueModelId
): Promise<Model[]> {
  if (mentionedModelIds?.length) {
    return Promise.all(
      mentionedModelIds.map(async (uniqueModelId) => {
        const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
        return modelService.getByKey(providerId, modelId)
      })
    )
  }

  const { providerId, modelId } = parseUniqueModelId(defaultModelId)
  return [await modelService.getByKey(providerId, modelId)]
}

/**
 * Resolve the model to use for this turn. When `assistantId` is provided, the
 * model comes from that assistant. Otherwise — for topics with no associated
 * assistant — the model falls back to the `chat.default_model_id` preference,
 * and the returned `assistantId` is `undefined` (not a sentinel).
 */
export async function resolveAssistantModelId(
  assistantId: string | null | undefined
): Promise<{ assistantId: string | undefined; defaultModelId: UniqueModelId; assistant: Assistant }> {
  if (assistantId) {
    const assistant = await assistantDataService.getById(assistantId)
    if (!assistant.modelId) throw new Error(`Assistant ${assistantId} has no model configured`)
    return { assistantId, defaultModelId: assistant.modelId, assistant }
  }

  const defaultModelId = application.get('PreferenceService').get('chat.default_model_id') as UniqueModelId | null
  if (!defaultModelId) throw new Error('No default model configured for assistant-less topic')
  const defaultAssistant = application.get('PreferenceService').get('chat.default_assistant')
  return {
    assistantId: undefined,
    defaultModelId,
    assistant: composeDefaultAssistant(defaultModelId, defaultAssistant)
  }
}

/**
 * Compute the siblingsGroupId for this turn. Pure read — no writes.
 *
 * - Multi-model: always a fresh group id so parallel responses are rendered as siblings.
 * - Regenerate: inherit existing sibling group if present, otherwise allocate a new one.
 *   The actual backfill of existing children with `siblingsGroupId = 0` is handled
 *   atomically inside `messageService.reserveAssistantTurn`.
 * - Single-model fresh turn: undefined (no sibling grouping needed).
 *
 * Persistent-topic only helper; temporary topics have no branching / siblings concept.
 */
export async function resolvePersistentSiblingsGroupId(
  models: Model[],
  isRegenerate: boolean,
  userMessageId: string
): Promise<number | undefined> {
  if (models.length > 1) return nextSiblingsGroupId()
  if (!isRegenerate) return undefined

  const children = await messageService.getChildrenByParentId(userMessageId)
  const existingGroup = children.find((m) => m.siblingsGroupId > 0)?.siblingsGroupId
  return existingGroup ?? nextSiblingsGroupId()
}
