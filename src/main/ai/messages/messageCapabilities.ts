/**
 * Capability-aware message shaping: drop media a model can't accept before it
 * reaches the provider.
 *
 * Modality support is **model-intrinsic** (a model is vision/video/audio-capable
 * regardless of which `@ai-sdk/*` adapter or endpoint it routes through), so this
 * keys on model predicates — unlike message *shape* (alternation etc.), which is
 * adapter-determined. The renderer already gates *new* attachments by capability,
 * but history is replayed from the DB unfiltered, so switching to a non-vision
 * model and continuing would otherwise send unsupported media → provider error.
 */

import type { Model } from '@shared/data/types/model'
import { isAudioModel, isVideoModel, isVisionModel } from '@shared/utils/model'
import type { ModelMessage, ToolResultPart, UIMessage } from 'ai'

import type { TokenDialect } from '../tokens/dialect'

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

const NO_MEDIA: MediaCapabilities = { image: false, video: false, audio: false }

/**
 * Media a tool result can carry to this wire+model. OpenAI-style wires (openai, ollama)
 * have no media slot in tool messages — the SDK JSON-stringifies `{type:'content'}` outputs,
 * so an image there would ride as unreadable base64 text. Gate it to the omitted-media note
 * instead, even for vision models; other wires fall back to the model's own capabilities.
 */
export function resolveToolResultMediaCapabilities(caps: MediaCapabilities, dialect: TokenDialect): MediaCapabilities {
  return dialect === 'openai' || dialect === 'ollama' ? NO_MEDIA : caps
}

type GatedModality = keyof MediaCapabilities

/** image/video/audio are capability-gated; other types (pdf, text, …) are not. */
function gatedModality(mediaType: string): GatedModality | undefined {
  if (mediaType.startsWith('image/')) return 'image'
  if (mediaType.startsWith('video/')) return 'video'
  if (mediaType.startsWith('audio/')) return 'audio'
  return undefined
}

/** The placeholder that replaces a modality the model can't accept. */
function omittedMediaNote(modality: GatedModality): string {
  return `[${modality} attachment omitted: this model does not accept ${modality} input]`
}

/**
 * Replace `file` parts whose modality the model can't accept with a text note.
 *
 * Replacing in place (vs. dropping) keeps the turn non-empty and tells the model
 * an attachment was there, without depending on the coalesce/empty-assistant
 * rules to clean up after a deletion. Non image/video/audio files (e.g. PDFs) are
 * left untouched — their handling is a separate concern. Operates on UIMessages
 * before conversion.
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
      return { type: 'text', text: omittedMediaNote(modality) }
    })
    return changed ? ({ ...message, parts } as T) : message
  })
}

/** A single item in a tool-result `{type:'content'}` output. */
type ToolResultContentItem = Extract<ToolResultPart['output'], { type: 'content' }>['value'][number]

/** Modality of a tool-result content item, or `undefined` when it isn't gated media. */
function itemModality(item: ToolResultContentItem): GatedModality | undefined {
  switch (item.type) {
    case 'image-data':
    case 'image-url':
    case 'image-file-id':
      return 'image'
    case 'media':
    case 'file-data':
      return gatedModality(item.mediaType)
    default:
      return undefined
  }
}

/**
 * Capability-gate media embedded in tool-result `{type:'content'}` outputs — the sibling of
 * {@link stripUnsupportedMedia}, which only handles top-level `file` parts. Runs on
 * `ModelMessage[]` after conversion (the stable SDK shape); replaces each image/video/audio
 * item the model can't accept with a text note, preserving references when nothing changes.
 */
export function gateToolResultMedia(messages: ModelMessage[], caps: MediaCapabilities): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== 'tool') return message
    let messageChanged = false
    const content = message.content.map((part) => {
      if (part.type !== 'tool-result' || part.output.type !== 'content') return part
      let changed = false
      const value = part.output.value.map((item) => {
        const modality = itemModality(item)
        if (!modality || caps[modality]) return item
        changed = true
        return { type: 'text' as const, text: omittedMediaNote(modality) }
      })
      if (!changed) return part
      messageChanged = true
      return { ...part, output: { ...part.output, value } }
    })
    return messageChanged ? { ...message, content } : message
  })
}
