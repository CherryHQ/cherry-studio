import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import type { Model } from '@renderer/types'

/**
 * Keep assistant model selection aligned with the legacy assistant settings:
 * assistants can only pick chat-capable models, not embedding / rerank models.
 */
export function isSelectableAssistantModel(model: Model): boolean {
  return !isEmbeddingModel(model) && !isRerankModel(model)
}

// NOTE: Earlier versions exported a `resolveAssistantModelName` helper that
// reverse-looked up `Model.name` from the (Redux-backed) providers list in the
// renderer. The resolution is now done in the main process via
// `AssistantService` inline JOIN on `user_model`, and list consumers read
// `assistant.modelName` directly — no client-side reverse lookup needed.
