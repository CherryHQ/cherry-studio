/**
 * Capability-aware message shaping: drop audio/video a model can't accept before
 * it reaches the provider. Images are gated earlier by attachment routing: legacy
 * images remain capability-gated, while first-party non-vision images become OCR
 * text or a deliberate native fallback that must reach the provider.
 *
 * Modality support is **model-intrinsic** (a model is vision/video/audio-capable
 * regardless of which `@ai-sdk/*` adapter or endpoint it routes through), so this
 * keys on model predicates — unlike message *shape* (alternation etc.), which is
 * adapter-determined. The renderer already gates new audio/video attachments by
 * capability, but history is replayed from the DB unfiltered, so switching models
 * would otherwise send unsupported audio/video → provider error.
 */

import type { Model } from '@shared/data/types/model'
import { isAudioModel, isVideoModel, isVisionModel } from '@shared/utils/model'
import type { UIMessage } from 'ai'

export interface MediaCapabilities {
  image: boolean
  video: boolean
  audio: boolean
}

/** All-accepting — used as the safe default when capabilities are unknown. */
export const ALL_MEDIA: MediaCapabilities = { image: true, video: true, audio: true }

export function resolveMediaCapabilities(model: Model): MediaCapabilities {
  return { image: isVisionModel(model), video: isVideoModel(model), audio: isAudioModel(model) }
}

type GatedModality = 'video' | 'audio'

/** Image routing is already complete; only video/audio still need gating here. */
function gatedModality(mediaType: string): GatedModality | undefined {
  if (mediaType.startsWith('video/')) return 'video'
  if (mediaType.startsWith('audio/')) return 'audio'
  return undefined
}

/**
 * Replace audio/video `file` parts the model can't accept with a text note.
 *
 * Replacing in place (vs. dropping) keeps the turn non-empty and tells the model
 * an attachment was there, without depending on the coalesce/empty-assistant
 * rules to clean up after a deletion. Images have already been handled by
 * `prepareChatMessages`; other files (e.g. PDFs) are a separate concern. Operates
 * on UIMessages before conversion.
 */
export function stripUnsupportedMedia<T extends UIMessage = UIMessage>(messages: T[], caps: MediaCapabilities): T[] {
  return messages.map((message) => {
    if (!message.parts?.length) return message
    let changed = false
    const parts = message.parts.map((part) => {
      if (part.type !== 'file') return part
      const modality = gatedModality(part.mediaType)
      if (!modality || caps[modality]) return part
      changed = true
      return { type: 'text', text: `[${modality} attachment omitted: this model does not accept ${modality} input]` }
    })
    return changed ? ({ ...message, parts } as T) : message
  })
}
