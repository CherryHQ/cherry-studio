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
import type { ImagePart, ModelMessage, ToolResultPart, UIMessage } from 'ai'

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

/** Image routing is already complete; only video/audio still need gating here. */
function gatedModality(mediaType: string): GatedModality | undefined {
  if (mediaType.startsWith('video/')) return 'video'
  if (mediaType.startsWith('audio/')) return 'audio'
  return undefined
}

/** The placeholder that replaces a modality the model can't accept. */
function omittedMediaNote(modality: GatedModality): string {
  return `[${modality} attachment omitted: this model does not accept ${modality} input]`
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

/**
 * OpenAI-style tool messages have no image slot. When the model itself supports vision, move
 * base64 tool-result images into one synthetic user message after the complete contiguous tool
 * result run; keeping the run intact preserves multi-tool call/result adjacency.
 */
export function routeToolResultMedia(
  messages: ModelMessage[],
  modelCaps: MediaCapabilities,
  toolResultCaps: MediaCapabilities
): ModelMessage[] {
  if (toolResultCaps.image || !modelCaps.image) return gateToolResultMedia(messages, toolResultCaps)

  let changed = false
  const out: ModelMessage[] = []
  let pendingParts: Array<{ type: 'text'; text: string } | ImagePart> = []

  const flushImages = () => {
    if (pendingParts.length === 0) return
    out.push({ role: 'user', content: pendingParts })
    pendingParts = []
  }

  messages.forEach((message, index) => {
    if (message.role !== 'tool') {
      flushImages()
      out.push(message)
      return
    }

    let messageChanged = false
    const content = message.content.map((part) => {
      if (part.type !== 'tool-result' || part.output.type !== 'content') return part
      let partChanged = false
      let imageIndex = 0
      const value = part.output.value.map((item) => {
        if (item.type !== 'image-data') return item
        const anchor = `[tool-result attachment call_id=${JSON.stringify(part.toolCallId)} image=${++imageIndex}]`
        pendingParts.push(
          { type: 'text', text: anchor },
          {
            type: 'image',
            image: item.data,
            mediaType: item.mediaType,
            ...(item.providerOptions && { providerOptions: item.providerOptions })
          }
        )
        partChanged = true
        return {
          type: 'text' as const,
          text: `${anchor} (${item.mediaType}): attached in the following user message`
        }
      })
      if (!partChanged) return part
      messageChanged = true
      return { ...part, output: { ...part.output, value } }
    })
    if (messageChanged) {
      changed = true
      out.push({ ...message, content })
    } else {
      out.push(message)
    }

    if (messages[index + 1]?.role !== 'tool') flushImages()
  })

  return gateToolResultMedia(changed ? out : messages, toolResultCaps)
}
