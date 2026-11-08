import { application } from '@application'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { fileEntryService } from '@data/services/FileEntryService'
import { extractAgentSessionId, isAgentSessionTopic } from '@main/ai/agentSession/topic'
import { isToolOutputBlobEntry } from '@main/ai/contextBuild/toolOutputStore'
import {
  blobRefsOf,
  isPersistedToolOutput,
  type PersistedToolOutput,
  type AiToolResultRequest,
  type AiToolResultResponse
} from '@shared/ai/transport'

import { findPersistedToolOutput, resolvePersistedToolOutput } from './persistedToolOutput'
import { projectToolResultImageResources } from './toolResultImageResources'

export const TOOL_RESULT_PREVIEW_BYTES = 32 * 1024
export const TOOL_RESULT_RANGE_BYTES = 256 * 1024

/** Slice serialized bytes without splitting a UTF-8 code point. */
export function toolResultTextRange(bytes: Buffer, cursor: number, hasMore = false): AiToolResultResponse {
  let end = Math.min(bytes.length, TOOL_RESULT_RANGE_BYTES)
  while (end > 0 && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
  return {
    status: 'ready',
    purpose: 'text-range',
    text: bytes.subarray(0, end).toString('utf8'),
    ...(hasMore || end < bytes.length ? { nextCursor: cursor + end } : {})
  }
}

/** Preserve typed presentation fields while bounding strings, collections and total payload. */
export function toolResultPreview(output: unknown): Extract<AiToolResultResponse, { purpose: 'preview' }> {
  let remaining = TOOL_RESULT_PREVIEW_BYTES - 1024
  let truncated = false
  const visit = (value: unknown, depth: number): unknown => {
    if (remaining <= 0 || depth > 12) {
      truncated = true
      return null
    }
    if (typeof value === 'string') {
      let candidate = value.slice(0, Math.min(value.length, remaining, 8 * 1024))
      if (candidate.length < value.length && /[\uD800-\uDBFF]$/.test(candidate)) candidate = candidate.slice(0, -1)
      while (Buffer.byteLength(JSON.stringify(candidate)) > remaining && candidate.length) {
        candidate = candidate.slice(0, Math.floor(candidate.length / 2))
        if (/[\uD800-\uDBFF]$/.test(candidate)) candidate = candidate.slice(0, -1)
      }
      remaining -= Buffer.byteLength(JSON.stringify(candidate))
      truncated ||= candidate.length < value.length
      return candidate
    }
    if (!value || typeof value !== 'object') {
      remaining -= 16
      return value
    }
    const entries = Array.isArray(value) ? value.entries() : Object.entries(value)
    const result: Record<string, unknown> = {}
    const items: unknown[] = []
    let count = 0
    for (const [key, item] of entries) {
      if (remaining <= 0 || count++ >= 128) {
        truncated = true
        break
      }
      remaining -= Buffer.byteLength(String(key)) + 8
      const projected = visit(item, depth + 1)
      if (Array.isArray(value)) items.push(projected)
      else result[key] = projected
    }
    return Array.isArray(value) ? items : result
  }
  const preview = visit(output, 0)
  const response = { status: 'ready', purpose: 'preview', output: preview, truncated } as const
  if (Buffer.byteLength(JSON.stringify(response)) <= TOOL_RESULT_PREVIEW_BYTES) return response
  return { status: 'ready', purpose: 'preview', output: null, truncated: true }
}

async function readPersistedRange(output: PersistedToolOutput, cursor: number): Promise<AiToolResultResponse> {
  const ref = output.$persistedToolOutput
  const segments = [
    ...(ref.shape === 'entities' ? [Buffer.from(JSON.stringify(ref.skeleton) + '\n')] : []),
    ...blobRefsOf(ref).flatMap((blob) => {
      const entry = fileEntryService.findById(blob.fileEntryId)
      const body = entry && isToolOutputBlobEntry(entry) ? entry : Buffer.from([blob.head, '…', blob.tail].join('\n'))
      return ref.shape === 'entities' ? [Buffer.from(`\n[${blob.key}]\n`), body] : [body]
    })
  ]
  let offset = cursor
  let remaining = TOOL_RESULT_RANGE_BYTES + 4
  const chunks: Buffer[] = []
  let total = 0
  for (const segment of segments) {
    const size = Buffer.isBuffer(segment) ? segment.length : segment.size
    total += size
    if (offset >= size) {
      offset -= size
      continue
    }
    if (remaining <= 0) continue
    const bytes = Buffer.isBuffer(segment)
      ? segment.subarray(offset, offset + remaining)
      : Buffer.from((await application.get('FileManager').readChunk(segment.id, offset, remaining)).content)
    chunks.push(bytes)
    remaining -= bytes.length
    offset = 0
  }
  const bytes = Buffer.concat(chunks)
  if (cursor > total || (bytes.length && (bytes[0] & 0xc0) === 0x80)) return { status: 'unavailable' }
  return toolResultTextRange(bytes, cursor, cursor + bytes.length < total)
}

export async function readToolResult(request: AiToolResultRequest): Promise<AiToolResultResponse> {
  const { topicId, messageId, toolCallId } = request
  const live = application.get('AiStreamManager').getDeferredToolOutput(topicId, toolCallId, messageId)
  if (!live.found && request.purpose === 'text-range' && isAgentSessionTopic(topicId)) {
    const range = agentSessionMessageService.getSessionToolOutputRange(
      extractAgentSessionId(topicId),
      messageId,
      toolCallId,
      request.cursor ?? 0
    )
    if (range === null) return { status: 'unavailable' }
    if (range) return toolResultTextRange(range.bytes, request.cursor ?? 0, range.hasMore)
  }
  const result = live.found
    ? live
    : await findPersistedToolOutput(topicId, messageId, toolCallId, request.purpose !== 'text-range')
  if (!result.found) return { status: 'unavailable' }
  if (isPersistedToolOutput(result.output)) {
    if (request.purpose === 'text-range') return readPersistedRange(result.output, request.cursor ?? 0)
    result.output = await resolvePersistedToolOutput(result.output)
  }
  if (request.purpose === 'full') return { status: 'ready', purpose: 'full', output: result.output }
  if (request.purpose === 'preview') return toolResultPreview(projectToolResultImageResources(result.output, request))
  const serialized =
    live.found && live.serializedBytes !== undefined
      ? live.serializedBytes
      : Buffer.from(JSON.stringify(result.output) ?? 'null')
  const cursor = request.cursor ?? 0
  if (cursor > serialized.length || (cursor < serialized.length && (serialized[cursor] & 0xc0) === 0x80))
    return { status: 'unavailable' }
  return toolResultTextRange(serialized.subarray(cursor), cursor)
}
