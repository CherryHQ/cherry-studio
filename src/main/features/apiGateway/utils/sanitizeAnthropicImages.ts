import type {
  ContentBlockParam,
  ImageBlockParam,
  MessageParam,
  TextBlockParam,
  ToolResultBlockParam
} from '@anthropic-ai/sdk/resources/messages'

type ToolResultContentBlock = Exclude<ToolResultBlockParam['content'], string | undefined>[number]

import { createHash } from 'node:crypto'

import { isDecodableImage } from '@main/utils/image'

export const UNDECODABLE_IMAGE_PLACEHOLDER = '[image could not be decoded]'

type SanitizeResult = {
  messages: MessageParam[]
  replacedCount: number
}

function textPlaceholder(): TextBlockParam {
  return { type: 'text', text: UNDECODABLE_IMAGE_PLACEHOLDER }
}

/**
 * A long Agent transcript replays every stored image on every turn, and a full
 * sharp decode costs ~300ms per screenshot - so verdicts are cached by content
 * hash (bounded FIFO). Bytes are only materialized on a cache miss.
 */
const DECODE_VERDICT_CACHE_LIMIT = 256
const decodeVerdictCache = new Map<string, boolean>()

async function sanitizeImageBlock(block: ImageBlockParam): Promise<ContentBlockParam> {
  if (block.source.type !== 'base64') return block
  const data = block.source.data
  const key = createHash('sha256').update(data).digest('hex')
  let decodable = decodeVerdictCache.get(key)
  if (decodable === undefined) {
    decodable = await isDecodableImage(Buffer.from(data, 'base64'))
    decodeVerdictCache.set(key, decodable)
    if (decodeVerdictCache.size > DECODE_VERDICT_CACHE_LIMIT) {
      const oldest = decodeVerdictCache.keys().next().value
      if (oldest !== undefined) decodeVerdictCache.delete(oldest)
    }
  }
  if (decodable) return block
  return textPlaceholder()
}

async function sanitizeContentBlocks(content: MessageParam['content']): Promise<{
  content: MessageParam['content']
  replacedCount: number
}> {
  if (typeof content === 'string' || !Array.isArray(content)) {
    return { content, replacedCount: 0 }
  }

  let replacedCount = 0
  const out: ContentBlockParam[] = []
  for (const block of content) {
    if (block.type === 'image') {
      const next = await sanitizeImageBlock(block)
      if (next.type === 'text') replacedCount += 1
      out.push(next)
      continue
    }

    if (block.type === 'tool_result' && Array.isArray(block.content)) {
      const nested: ToolResultContentBlock[] = []
      for (const item of block.content) {
        if (item.type === 'image') {
          const next = await sanitizeImageBlock(item)
          if (next.type === 'text') replacedCount += 1
          nested.push(next.type === 'text' ? next : (next as ImageBlockParam))
        } else {
          nested.push(item)
        }
      }
      out.push({ ...block, content: nested })
      continue
    }

    out.push(block)
  }

  return { content: out, replacedCount }
}

/**
 * Replace undecodable base64 image blocks in an Anthropic request before it reaches
 * the provider. Sticky corrupt images in Claude Code CLI transcripts otherwise 400
 * every turn at a fixed message index.
 */
export async function sanitizeAnthropicRequestImages(messages: MessageParam[]): Promise<SanitizeResult> {
  let replacedCount = 0
  const sanitized: MessageParam[] = []

  for (const message of messages) {
    const { content, replacedCount: replacedInMessage } = await sanitizeContentBlocks(message.content)
    replacedCount += replacedInMessage
    if (replacedInMessage === 0 && content === message.content) {
      sanitized.push(message)
    } else {
      sanitized.push({ ...message, content })
    }
  }

  if (replacedCount === 0) return { messages, replacedCount: 0 }
  return { messages: sanitized, replacedCount }
}
