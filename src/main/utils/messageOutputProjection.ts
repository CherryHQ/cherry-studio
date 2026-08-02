/**
 * Projects stored and live message tool outputs before they cross into the renderer.
 * Full oversized values remain addressable through `ai.tool.get_result`.
 */

import type { UIMessageChunk } from 'ai'
import { isToolUIPart } from 'ai'

import {
  CITATION_SNIPPET_MAX_CHARS,
  KB_READ_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  type KbGrepMatch,
  kbGrepOutputSchema,
  kbReadOutputSchema,
  kbSearchOutputSchema,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  webSearchOutputSchema
} from '@shared/ai/builtinTools'
import {
  type DeferredToolOutput,
  type DeferredToolResultRef,
  envelopeDisplayExcerpt,
  isDeferredToolOutput,
  isPersistedToolOutput
} from '@shared/ai/transport'
import type { CherryMessagePart } from '@shared/data/types/message'

/** Serialized UTF-8 size at or below which a result travels inline. */
export const DEFER_TOOL_OUTPUT_BYTES = 32 * 1024

const CHERRY_TOOLS_MCP_SERVER = 'cherry-tools'
const CITABLE_TOOL_NAMES: ReadonlySet<string> = new Set([
  WEB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  KB_READ_TOOL_NAME
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toCitationSnippet(content: string): string {
  const trimmed = content.trim()
  if (trimmed.length <= CITATION_SNIPPET_MAX_CHARS) return trimmed
  return `${trimmed.slice(0, CITATION_SNIPPET_MAX_CHARS)}…`
}

/** Keep grep matches in order until their joined citation preview reaches its text budget. */
function toCitationGrepMatches(matches: KbGrepMatch[]): KbGrepMatch[] {
  const projected: KbGrepMatch[] = []
  let remainingChars = CITATION_SNIPPET_MAX_CHARS

  for (const match of matches) {
    const separatorChars = projected.length === 0 ? 0 : ' … '.length
    if (remainingChars <= separatorChars) {
      const last = projected.at(-1)
      if (last) last.snippet = `${last.snippet}…`
      break
    }

    remainingChars -= separatorChars
    const snippet = match.snippet.trim()
    if (snippet.length > remainingChars) {
      projected.push({ ...match, snippet: `${snippet.slice(0, remainingChars)}…` })
      break
    }

    projected.push({ ...match, snippet })
    remainingChars -= snippet.length
  }

  return projected
}

/** Keep only the schema-valid fields and bounded snippets needed to render citations. */
function toCitationPayloadSkeleton(output: unknown): unknown | undefined {
  const web = webSearchOutputSchema.safeParse(output)
  if (web.success) {
    return web.data.map((item) => ({ ...item, content: toCitationSnippet(item.content) }))
  }

  const knowledgeSearch = kbSearchOutputSchema.safeParse(output)
  if (knowledgeSearch.success) {
    return knowledgeSearch.data.map((item) => ({ ...item, content: toCitationSnippet(item.content) }))
  }

  const knowledgeRead = kbReadOutputSchema.safeParse(output)
  if (knowledgeRead.success) {
    return { ...knowledgeRead.data, content: toCitationSnippet(knowledgeRead.data.content) }
  }

  const knowledgeGrep = kbGrepOutputSchema.safeParse(output)
  if (knowledgeGrep.success) {
    return {
      ...knowledgeGrep.data,
      matches: toCitationGrepMatches(knowledgeGrep.data.matches)
    }
  }

  return undefined
}

/**
 * Extract a citation skeleton from schema-valid builtin output or an MCP envelope
 * attributed to Cherry Tools by its server id or user-visible server name.
 */
function toCitationSkeleton(output: unknown): unknown | undefined {
  if (!isRecord(output) || !isRecord(output.metadata)) return toCitationPayloadSkeleton(output)

  const metadata = output.metadata
  const toolName = typeof metadata.name === 'string' ? metadata.name : undefined
  const belongsToCherryTools =
    metadata.serverId === CHERRY_TOOLS_MCP_SERVER || metadata.serverName === CHERRY_TOOLS_MCP_SERVER
  // Older agent messages predate MCP output names. Their Cherry Tools server id or name plus
  // a citable payload schema is sufficient; the renderer still gates on the part's tool name.
  if (metadata.type !== 'mcp' || !belongsToCherryTools || (toolName && !CITABLE_TOOL_NAMES.has(toolName))) {
    return undefined
  }

  const content = toCitationPayloadSkeleton(output.content)
  if (content === undefined) return undefined

  return {
    content,
    metadata: {
      type: 'mcp',
      ...(toolName ? { name: toolName } : {}),
      ...(typeof metadata.serverId === 'string' ? { serverId: metadata.serverId } : {}),
      ...(typeof metadata.serverName === 'string' ? { serverName: metadata.serverName } : {})
    }
  }
}

/** Whether a serialized payload exceeds the renderer transport budget. */
function exceedsToolOutputTransportLimit(output: unknown): boolean {
  if (output === undefined || output === null) return false
  try {
    const serialized = JSON.stringify(output)
    if (serialized === undefined) return false
    // UTF-16 code units are a lower bound on UTF-8 bytes, so this short-circuits without encoding.
    if (serialized.length > DEFER_TOOL_OUTPUT_BYTES) return true
    return new TextEncoder().encode(serialized).length > DEFER_TOOL_OUTPUT_BYTES
  } catch {
    return false
  }
}

export function shouldDeferToolOutput(output: unknown): boolean {
  if (output === undefined || output === null || isDeferredToolOutput(output)) return false
  return exceedsToolOutputTransportLimit(output)
}

function withCitationSkeleton(deferred: DeferredToolOutput, output: unknown): DeferredToolOutput {
  const skeleton = toCitationSkeleton(output)
  if (skeleton === undefined) return deferred

  const projected = { ...deferred, skeleton } satisfies DeferredToolOutput
  if (!exceedsToolOutputTransportLimit(projected)) return projected

  const entities = Array.isArray(skeleton)
    ? skeleton
    : isRecord(skeleton) && Array.isArray(skeleton.content)
      ? skeleton.content
      : undefined
  if (!entities || entities.length <= 1) return deferred

  // Citation order defines display numbering, so retain the longest prefix that fits.
  for (let end = entities.length - 1; end > 0; end -= 1) {
    const trimmedSkeleton = Array.isArray(skeleton)
      ? entities.slice(0, end)
      : { ...skeleton, content: entities.slice(0, end) }
    const trimmed = { ...deferred, skeleton: trimmedSkeleton } satisfies DeferredToolOutput
    if (!exceedsToolOutputTransportLimit(trimmed)) return trimmed
  }

  return deferred
}

function projectToolOutputForRenderer(output: unknown, ref: DeferredToolResultRef): unknown {
  if (isPersistedToolOutput(output)) {
    const persisted = output.$persistedToolOutput
    const deferred = {
      $deferredToolResult: ref,
      excerpt: envelopeDisplayExcerpt(persisted)
    } satisfies DeferredToolOutput
    return persisted.shape === 'entities' ? withCitationSkeleton(deferred, persisted.skeleton) : deferred
  }

  if (!shouldDeferToolOutput(output)) return output
  return withCitationSkeleton({ $deferredToolResult: ref }, output)
}

/** Projects a stored or finalized message part. Returns the same object when nothing changed. */
export function projectMessagePartForRenderer(
  part: CherryMessagePart,
  topicId: string,
  messageId: string
): CherryMessagePart {
  if (!isToolUIPart(part) || part.state !== 'output-available') return part

  const output = projectToolOutputForRenderer(part.output, {
    topicId,
    messageId,
    toolCallId: part.toolCallId
  })
  if (output === part.output) return part
  return { ...part, output }
}

/** Projects every part of a message. Returns the same array when nothing changed. */
export function projectMessagePartsForRenderer(
  parts: CherryMessagePart[],
  topicId: string,
  messageId: string
): CherryMessagePart[] {
  let projected: CherryMessagePart[] | undefined
  for (let index = 0; index < parts.length; index += 1) {
    const part = projectMessagePartForRenderer(parts[index], topicId, messageId)
    if (part === parts[index]) continue
    projected ??= [...parts]
    projected[index] = part
  }
  return projected ?? parts
}

/** Projects a live stream chunk. Returns the same object when nothing changed. */
export function projectStreamChunkForRenderer(
  chunk: UIMessageChunk,
  topicId: string,
  messageId: string | undefined
): UIMessageChunk {
  if (chunk.type !== 'tool-output-available' || !messageId) return chunk

  const output = projectToolOutputForRenderer(chunk.output, {
    topicId,
    messageId,
    toolCallId: chunk.toolCallId
  })
  if (output === chunk.output) return chunk
  return { ...chunk, output }
}
