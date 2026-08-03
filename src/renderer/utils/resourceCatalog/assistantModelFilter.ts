import type { Model } from '@shared/data/types/model'
import { isNonChatModel } from '@shared/utils/model'

/**
 * Assistants can only invoke chat models directly. Dedicated embedding,
 * rerank, image, video, audio, and transcription models are not selectable.
 */
export function isSelectableAssistantModel(model: Model): boolean {
  return !isNonChatModel(model)
}

// NOTE: Earlier versions exported a `resolveAssistantModelName` helper that
// reverse-looked up `Model.name` from the (Redux-backed) providers list in the
// renderer. The resolution is now done in the main process via
// `AssistantService` and the current ModelService runtime merge; list consumers
// read `assistant.modelName` directly — no client-side reverse lookup needed.
