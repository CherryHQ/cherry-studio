/**
 * `fs__read` tool — read a file's content into the conversation.
 *
 * Dispatch order (each step short-circuits on failure):
 *   1.  absolute path                  → relative-path
 *   2.  pre-realpath device check      → device-file (raw input — see deviceFileBlocklist.ts)
 *   3.  fs.realpath                    → not-found
 *   4.  post-realpath device check     → device-file (catches symlinks)
 *   5.  fs.stat                        → not-found
 *   6.  FIFO / socket detection        → pipe-or-socket
 *   7.  isFile()                       → not-a-file
 *   8.  size cap                       → too-large
 *   9.  image (vision model)           → image kind  (else: OCR via fileProcessingService → text)
 *   10. audio (audio-capable model)    → media kind  (else: unsupported-modality)
 *   11. video (video-capable model)    → media kind  (else: unsupported-modality)
 *   12. pdf (PDF-native provider)      → pdf kind    (else: fall through to text path)
 *   11. mtime dedup hit                → text with [unchanged…] prefix
 *   12. pdf / office / ipynb dispatch  → text kind via formatLines
 *   13. unknown extension              → binary heuristic, then text
 *
 * Capability gating (vision / PDF-native) lives in execute, not in
 * `toModelOutput`: the AI SDK signature for `toModelOutput` does not
 * carry the active model/provider, so the only way to reach the
 * RequestContext is here. `toModelOutput` stays a pure kind→chunk mapper.
 */

import fs from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'

import { fileProcessingService } from '@data/services/FileProcessingService'
import { makeNeedsApproval } from '@main/services/toolApproval/needsApproval'
import { isBinary } from '@main/utils/file'
import { MB } from '@shared/config/constant'
import { isAudioModel, isVideoModel, isVisionModel } from '@shared/utils/model'
import { type Tool, tool } from 'ai'
import * as z from 'zod'

import { supportsNativePdf } from '../../../utils/pdfNativeSupport'
import { getToolCallContext } from '../../context'
import { BuiltinToolNamespace, ToolCapability, ToolDefer, type ToolEntry } from '../../types'
import { isDevicePath } from './deviceFileBlocklist'
import { checkDedup, recordRead } from './readDedupCache'
import { readAsIpynb } from './readers/ipynb'
import {
  AUDIO_MIME_BY_EXT,
  IMAGE_MIME_BY_EXT,
  isAudioExtension,
  isImageExtension,
  isVideoExtension,
  VIDEO_MIME_BY_EXT
} from './readers/media'
import { OFFICE_EXTENSIONS, readAsOffice } from './readers/office'
import { readAsPdf } from './readers/pdf'
import { DEFAULT_READ_LIMIT, formatLines, readAsText } from './readers/text'

export const FS_READ_TOOL_NAME = 'fs__read'

const SIZE_CAP_BYTES = 5 * MB

const inputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe('Absolute file path. Relative paths are rejected (workspace-root resolution arrives in a follow-up).'),
  offset: z.number().int().min(1).optional().describe('1-indexed line number to start reading at. Default: 1.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(DEFAULT_READ_LIMIT)
    .optional()
    .describe(`Maximum number of lines to return in this call. Default: ${DEFAULT_READ_LIMIT}.`)
})

const outputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    text: z.string(),
    /** 1-indexed line of the first returned line. */
    startLine: z.number().int(),
    /** 1-indexed line of the last returned line (inclusive). */
    endLine: z.number().int(),
    /** Total lines in the file — lets the model paginate intelligently. */
    totalLines: z.number().int()
  }),
  z.object({
    kind: z.literal('image'),
    data: z.string(),
    mimeType: z.string()
  }),
  z.object({
    kind: z.literal('pdf'),
    data: z.string(),
    mediaType: z.literal('application/pdf')
  }),
  z.object({
    /** Audio / video raw bytes. Provider must accept the mediaType; the
     *  dispatcher only emits this kind for `isAudioModel` / `isVideoModel`. */
    kind: z.literal('media'),
    data: z.string(),
    mediaType: z.string()
  }),
  z.object({
    kind: z.literal('error'),
    code: z.enum([
      'relative-path',
      'not-found',
      'not-a-file',
      'binary',
      'too-large',
      'device-file',
      'pipe-or-socket',
      'parse-error',
      'unsupported-modality'
    ]),
    message: z.string()
  })
])

type FsReadOutput = z.infer<typeof outputSchema>

/**
 * Pure mapper from output `kind` to the AI SDK chunk shape:
 *   text  → text part
 *   image → image-data content part (vision-model branch picks this)
 *   pdf   → file-data content part (PDF-native-provider branch picks this)
 *   error → error-text part
 *
 * Capability gating happens upstream in `execute` — this function is the
 * single switch from internal kinds to provider-visible AI SDK chunks.
 */
function fsReadToModelOutput({ output }: { toolCallId: string; input: unknown; output: FsReadOutput }):
  | { type: 'text'; value: string }
  | { type: 'error-text'; value: string }
  | {
      type: 'content'
      value: Array<
        { type: 'image-data'; data: string; mediaType: string } | { type: 'file-data'; data: string; mediaType: string }
      >
    } {
  if (output.kind === 'error') {
    return { type: 'error-text', value: `[Error: ${output.code}] ${output.message}` }
  }
  if (output.kind === 'image') {
    return { type: 'content', value: [{ type: 'image-data', data: output.data, mediaType: output.mimeType }] }
  }
  if (output.kind === 'pdf' || output.kind === 'media') {
    return { type: 'content', value: [{ type: 'file-data', data: output.data, mediaType: output.mediaType }] }
  }
  const remaining = output.totalLines - output.endLine
  const tail =
    remaining > 0
      ? `\n\n[showing lines ${output.startLine}-${output.endLine} of ${output.totalLines}; ${remaining} more — call again with offset=${output.endLine + 1} to continue]`
      : ''
  return { type: 'text', value: `${output.text}${tail}` }
}

const fsReadTool = tool({
  description: `Read a file's content into the conversation.

Use this when:
- The user asks about specific code, config, or document content
- You need to verify or quote exact text from a file before answering or editing

Paths must be absolute. Relative paths are rejected.

Pagination:
- Use \`offset\` (1-indexed line) + \`limit\` to read in chunks for large files
- Result includes \`totalLines\` so you can decide whether more pages are needed

Supports text/code, images (PNG/JPG/etc.), PDF, Office docs (DOCX/XLSX/PPTX/ODT/ODS/ODP), and Jupyter notebooks. Files over 256 KB are rejected with \`too-large\`.`,
  inputSchema,
  outputSchema,
  toModelOutput: fsReadToModelOutput,
  needsApproval: makeNeedsApproval(FS_READ_TOOL_NAME),
  execute: async ({ path: requestedPath, offset, limit }, options) => {
    const { request } = getToolCallContext(options)
    const topicId = request.topicId ?? '__no_topic__'

    if (!isAbsolute(requestedPath)) {
      return {
        kind: 'error' as const,
        code: 'relative-path' as const,
        message: `Path must be absolute. Got: ${requestedPath}`
      }
    }

    if (isDevicePath(requestedPath)) {
      return {
        kind: 'error' as const,
        code: 'device-file' as const,
        message: `Refusing to read kernel pseudo-file: ${requestedPath}`
      }
    }

    let absolutePath: string
    try {
      absolutePath = await fs.realpath(requestedPath)
    } catch (err) {
      return {
        kind: 'error' as const,
        code: 'not-found' as const,
        message: err instanceof Error ? err.message : String(err)
      }
    }

    if (isDevicePath(absolutePath)) {
      return {
        kind: 'error' as const,
        code: 'device-file' as const,
        message: `Refusing to read kernel pseudo-file: ${absolutePath}`
      }
    }

    let stats: Awaited<ReturnType<typeof fs.stat>>
    try {
      stats = await fs.stat(absolutePath)
    } catch (err) {
      return {
        kind: 'error' as const,
        code: 'not-found' as const,
        message: err instanceof Error ? err.message : String(err)
      }
    }
    if (stats.isFIFO() || stats.isSocket()) {
      return {
        kind: 'error' as const,
        code: 'pipe-or-socket' as const,
        message: `Refusing to read pipe / socket: ${absolutePath}`
      }
    }
    if (!stats.isFile()) {
      return {
        kind: 'error' as const,
        code: 'not-a-file' as const,
        message: `Path is not a file: ${absolutePath}`
      }
    }
    // TODO: when the active provider exposes a remote-file API
    // (`src/main/services/remotefile/` — OpenAI, Gemini, Mistral),
    // route oversize files through `FileServiceManager` and emit a
    // `file-id` chunk instead of inlining bytes. That removes this
    // cap for capable providers; today every emit is inline so we
    // hold the line at 5 MB to protect context + IPC payload size.
    if (stats.size > SIZE_CAP_BYTES) {
      return {
        kind: 'error' as const,
        code: 'too-large' as const,
        message: `File is ${stats.size} bytes; max is ${SIZE_CAP_BYTES} bytes.`
      }
    }

    const ext = extname(absolutePath).toLowerCase()

    // Image dispatch — vision-capable models receive the image bytes
    // directly; non-vision models route through fileProcessingService's
    // OCR facade so the model still sees something useful.
    // mtime dedup doesn't apply to image / audio / video kinds.
    if (isImageExtension(ext)) {
      if (request.model && isVisionModel(request.model)) {
        const img = await fs.readFile(absolutePath)
        return {
          kind: 'image' as const,
          data: img.toString('base64'),
          mimeType: IMAGE_MIME_BY_EXT[ext] ?? 'image/png'
        }
      }
      try {
        const text = await fileProcessingService.extractImageText(absolutePath)
        const result = formatLines(text, offset, limit)
        return { kind: 'text' as const, ...result }
      } catch (err) {
        return {
          kind: 'error' as const,
          code: 'parse-error' as const,
          message: err instanceof Error ? err.message : String(err)
        }
      }
    }

    // Audio / video dispatch — only emitted when the active model
    // accepts the modality natively (Gemini family, Claude Opus 4
    // audio, etc.). No fallback exists today: ASR / video-to-text
    // requires a separate processor pipeline that fs__read doesn't
    // own. If the model can't consume it, surface a structured error.
    if (isAudioExtension(ext)) {
      if (!request.model || !isAudioModel(request.model)) {
        return {
          kind: 'error' as const,
          code: 'unsupported-modality' as const,
          message: `Active model is not audio-capable; cannot consume ${ext} files.`
        }
      }
      const bytes = await fs.readFile(absolutePath)
      return {
        kind: 'media' as const,
        data: bytes.toString('base64'),
        mediaType: AUDIO_MIME_BY_EXT[ext] ?? 'application/octet-stream'
      }
    }
    if (isVideoExtension(ext)) {
      if (!request.model || !isVideoModel(request.model)) {
        return {
          kind: 'error' as const,
          code: 'unsupported-modality' as const,
          message: `Active model is not video-capable; cannot consume ${ext} files.`
        }
      }
      const bytes = await fs.readFile(absolutePath)
      return {
        kind: 'media' as const,
        data: bytes.toString('base64'),
        mediaType: VIDEO_MIME_BY_EXT[ext] ?? 'application/octet-stream'
      }
    }

    // PDF dispatch when the active provider/model accepts native PDF
    // file parts — emit raw bytes. Non-native paths fall through to
    // the dedup + readAsPdf branch below, which routes through
    // `fileProcessingService.extractDocumentText` (PDF facade).
    if (ext === '.pdf' && request.provider && request.model && supportsNativePdf(request.provider, request.model)) {
      try {
        const data = await fs.readFile(absolutePath)
        return {
          kind: 'pdf' as const,
          data: data.toString('base64'),
          mediaType: 'application/pdf'
        }
      } catch (err) {
        return {
          kind: 'error' as const,
          code: 'parse-error' as const,
          message: err instanceof Error ? err.message : String(err)
        }
      }
    }

    // Text-shaped dispatch (returns line-numbered TextReadResult).
    const requestedStart = offset ?? 1
    const requestedEnd = (offset ?? 1) + (limit ?? DEFAULT_READ_LIMIT) - 1

    const dedupHit = checkDedup(topicId, absolutePath, stats.mtimeMs, requestedStart, requestedEnd)
    if (dedupHit) {
      return {
        kind: 'text' as const,
        text: dedupHit.text,
        startLine: dedupHit.startLine,
        endLine: dedupHit.endLine,
        totalLines: dedupHit.totalLines
      }
    }

    try {
      let result: { text: string; startLine: number; endLine: number; totalLines: number }
      if (ext === '.pdf') {
        result = await readAsPdf(absolutePath, offset, limit)
      } else if (OFFICE_EXTENSIONS.has(ext)) {
        result = await readAsOffice(absolutePath, offset, limit)
      } else if (ext === '.ipynb') {
        result = await readAsIpynb(absolutePath, offset, limit)
      } else {
        if (await isBinary(absolutePath)) {
          return {
            kind: 'error' as const,
            code: 'binary' as const,
            message: `Cannot read binary file: ${absolutePath}.`
          }
        }
        result = await readAsText(absolutePath, offset, limit)
      }

      recordRead(topicId, absolutePath, stats.mtimeMs, result.startLine, result.endLine, result.totalLines)
      return { kind: 'text' as const, ...result }
    } catch (err) {
      return {
        kind: 'error' as const,
        code: 'parse-error' as const,
        message: err instanceof Error ? err.message : String(err)
      }
    }
  }
}) as Tool

export function createReadFileToolEntry(): ToolEntry {
  return {
    name: FS_READ_TOOL_NAME,
    namespace: BuiltinToolNamespace.Fs,
    description: 'Read a file by absolute path. Supports text, images, PDF, Office docs, and Jupyter notebooks.',
    defer: ToolDefer.Never,
    capability: ToolCapability.Read,
    tool: fsReadTool,
    // Read-only tool — L3 always-allow. User can still add an explicit
    // deny rule at L2 (e.g. to forbid reading paths under `/etc`).
    checkPermissions: () => ({ behavior: 'allow' })
  }
}
