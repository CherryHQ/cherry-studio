import * as z from 'zod'

import { application } from '@application'
import { isPersistedToolOutput, type DeferredToolResultRef } from '@shared/ai/transport'

import { findPersistedToolOutput, resolvePersistedToolOutput } from './persistedToolOutput'

const imageSchema = z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string().startsWith('image/') })
const resourceIdentitySchema = z.object({
  topicId: z.string().min(1),
  messageId: z.string().min(1),
  toolCallId: z.string().min(1),
  imageIndex: z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .transform(Number)
    .pipe(z.number().int().nonnegative())
})

export function parseToolResultImageUrl(url: URL) {
  const segments = url.pathname.slice(1).split('/')
  if (segments.length !== 4) return undefined
  try {
    const parsed = resourceIdentitySchema.safeParse({
      topicId: decodeURIComponent(segments[0]),
      messageId: decodeURIComponent(segments[1]),
      toolCallId: decodeURIComponent(segments[2]),
      imageIndex: segments[3]
    })
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

/** Image bytes stay with their latest-result owner; resource URLs retain no additional payload. */
export function projectToolResultImageResources(output: unknown, ref: DeferredToolResultRef): unknown {
  let imageIndex = 0
  const prefix = [ref.topicId, ref.messageId, ref.toolCallId].map(encodeURIComponent).join('/')
  const visit = (value: unknown, depth: number): unknown => {
    if (depth > 12 || !value || typeof value !== 'object') return value
    const image = imageSchema.safeParse(value)
    if (image.success) {
      return {
        type: 'resource_link',
        uri: `cherry-media://tool-result/${prefix}/${imageIndex++}`,
        name: 'image',
        mimeType: image.data.mimeType
      }
    }
    if (Array.isArray(value)) return value.map((item) => visit(item, depth + 1))
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, depth + 1)]))
  }
  return visit(output, 0)
}

export async function readToolResultImage(ref: DeferredToolResultRef, imageIndex: number) {
  const live = application.get('AiStreamManager').getDeferredToolOutput(ref.topicId, ref.toolCallId, ref.messageId)
  const result = live.found ? live : await findPersistedToolOutput(ref.topicId, ref.messageId, ref.toolCallId)
  if (!result.found) return undefined
  let index = 0
  const find = (value: unknown, depth: number): z.infer<typeof imageSchema> | undefined => {
    if (depth > 12 || !value || typeof value !== 'object') return undefined
    const image = imageSchema.safeParse(value)
    if (image.success) return index++ === imageIndex ? image.data : undefined
    for (const item of Array.isArray(value) ? value : Object.values(value)) {
      const found = find(item, depth + 1)
      if (found) return found
    }
    return undefined
  }
  const output = isPersistedToolOutput(result.output) ? await resolvePersistedToolOutput(result.output) : result.output
  const image = find(output, 0)
  return image ? { data: Buffer.from(image.data, 'base64'), mimeType: image.mimeType } : undefined
}
