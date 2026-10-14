import path from 'node:path'

import type { ToolDefinition } from '@earendil-works/pi-coding-agent'

import { application } from '@application'
import { surrogateSafeEnd } from '@main/ai/utils/textPaging'
import { AbsoluteFilePathSchema, FILE_TYPE } from '@shared/types/file'
import { getFileTypeByExt } from '@shared/utils/file'

import { loadPiSdk } from './piSdk'

const MEDIA_READ_GUIDELINE =
  'For an audio or video file, read returns Cherry media analysis text (transcript, on-screen text, and visual summary). Do not probe those files with bash or ffmpeg.'

/**
 * Keep Pi's `read` name, schema, and approval identity. Audio and video paths
 * return MediaAnalysis text; every other file uses the original read implementation.
 */
export function wrapPiReadToolForMedia(definition: ToolDefinition, cwd: string): ToolDefinition {
  return {
    ...definition,
    description: `${definition.description} Audio and video files return Cherry media analysis (transcript, on-screen text, and visual summary) instead of raw bytes.`,
    promptGuidelines: [...(definition.promptGuidelines ?? []), MEDIA_READ_GUIDELINE],
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const requestedPath = readPathParam(params)
      if (!isAudioOrVideoPath(requestedPath)) {
        return definition.execute(toolCallId, params, signal, onUpdate, ctx)
      }
      signal?.throwIfAborted()
      const absolutePath = resolveMediaPath(requestedPath, ctx?.cwd || cwd)
      const parsed = AbsoluteFilePathSchema.safeParse(absolutePath)
      if (!parsed.success) return definition.execute(toolCallId, params, signal, onUpdate, ctx)
      const text = await application
        .get('MediaAnalysisService')
        .analyzeToFullText({ kind: 'path', path: parsed.data }, signal)
      signal?.throwIfAborted()
      const { offset, limit } = readWindow(params)
      const paged = await pageAnalysisText(text, offset, limit)
      signal?.throwIfAborted()
      return { content: [{ type: 'text', text: paged }] } as Awaited<ReturnType<typeof definition.execute>>
    }
  }
}

function readPathParam(params: unknown): string {
  if (!params || typeof params !== 'object' || !('path' in params)) return ''
  const value = (params as { path?: unknown }).path
  return typeof value === 'string' ? value : ''
}

function readWindow(params: unknown): { offset?: number; limit?: number } {
  if (!params || typeof params !== 'object') return {}
  const value = params as { offset?: unknown; limit?: unknown }
  return {
    offset: typeof value.offset === 'number' ? value.offset : undefined,
    limit: typeof value.limit === 'number' ? value.limit : undefined
  }
}

function isAudioOrVideoPath(filePath: string): boolean {
  const fileType = getFileTypeByExt(path.extname(filePath))
  return fileType === FILE_TYPE.AUDIO || fileType === FILE_TYPE.VIDEO
}

function resolveMediaPath(filePath: string, cwd: string): string {
  return path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(cwd, filePath)
}

async function pageAnalysisText(text: string, offset?: number, limit?: number): Promise<string> {
  const { DEFAULT_MAX_BYTES, formatSize, truncateHead } = await loadPiSdk()
  const allLines = text.split('\n')
  const startLine = offset ? Math.max(0, offset - 1) : 0
  if (startLine >= allLines.length) {
    throw new Error(`Offset ${offset} is beyond end of file (${allLines.length} lines total)`)
  }
  const startLineDisplay = startLine + 1
  let selectedContent: string
  let userLimitedLines: number | undefined
  if (limit !== undefined) {
    const endLine = Math.min(startLine + limit, allLines.length)
    selectedContent = allLines.slice(startLine, endLine).join('\n')
    userLimitedLines = endLine - startLine
  } else {
    selectedContent = allLines.slice(startLine).join('\n')
  }
  const truncation = truncateHead(selectedContent)
  if (truncation.firstLineExceedsLimit) {
    // Pi points this case at bash. Keep the read on this tool and return a bounded prefix.
    const line = allLines[startLine] ?? ''
    const clipped = line.slice(0, surrogateSafeEnd(line, byteBoundedEnd(line, DEFAULT_MAX_BYTES)))
    const clippedSize = formatSize(Buffer.byteLength(clipped, 'utf-8'))
    return `${clipped}\n\n[Line ${startLineDisplay} exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Showing the first ${clippedSize}.]`
  }
  if (truncation.truncated) {
    const endLineDisplay = startLineDisplay + truncation.outputLines - 1
    const nextOffset = endLineDisplay + 1
    const notice =
      truncation.truncatedBy === 'lines'
        ? `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${allLines.length}. Use offset=${nextOffset} to continue.]`
        : `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${allLines.length} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`
    return truncation.content + notice
  }
  if (userLimitedLines !== undefined && startLine + userLimitedLines < allLines.length) {
    const remaining = allLines.length - (startLine + userLimitedLines)
    const nextOffset = startLine + userLimitedLines + 1
    return `${truncation.content}\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`
  }
  return truncation.content
}

function byteBoundedEnd(text: string, maxBytes: number): number {
  if (Buffer.byteLength(text, 'utf-8') <= maxBytes) return text.length
  let low = 0
  let high = text.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(text.slice(0, mid), 'utf-8') <= maxBytes) low = mid
    else high = mid - 1
  }
  return low
}
