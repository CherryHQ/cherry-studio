/**
 * `fs__read` tool — read a file's content into the conversation.
 *
 * Migrated from `mcpServers/filesystem/tools/read.ts` (MCP-shape) to the
 * AI-SDK builtin tool registry. Behavioural deltas vs the old version:
 *
 *  - **Path policy**: absolute paths only. Old version used a baseDir
 *    sandbox + `validatePath`; cherry doesn't yet have a workspace-root
 *    concept on `RequestContext`, so we require absolute paths up-front
 *    and add relative-path support when the `cwd` field lands.
 *  - **Encoding**: switched from raw `utf-8` read to
 *    `readTextFileWithAutoEncoding` (chardet + iconv-lite) so non-UTF-8
 *    text files (Shift-JIS, GB18030, etc.) decode correctly.
 *  - **Binary detection**: uses `isBinary` from `@main/utils/file`
 *    (heuristic: BOM-aware + null-byte scan + control-char ratio) instead
 *    of the old MCP server's `isBinaryFile` helper.
 *  - **Output shape**: discriminated union `{ kind: 'text', ... } |
 *    { kind: 'error', code, ... }` instead of throwing — the model can
 *    branch on `kind` cleanly.
 *
 * Phase 1A: text/code files only. Image / PDF / Office formats follow.
 */

import fs from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

import { makeNeedsApproval } from '@main/services/toolApproval/needsApproval'
import { isBinary, readTextFileWithAutoEncoding } from '@main/utils/file'
import { type Tool, tool } from 'ai'
import * as z from 'zod'

import { BuiltinToolNamespace, ToolCapability, ToolDefer, type ToolEntry } from '../../types'

export const FS_READ_TOOL_NAME = 'fs__read'

const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000

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
    kind: z.literal('error'),
    code: z.enum(['relative-path', 'not-found', 'not-a-file', 'binary']),
    message: z.string()
  })
])

type FsReadOutput = z.infer<typeof outputSchema>

/**
 * Convert the structured tool output into what the model actually sees.
 * AI SDK uses `outputSchema` for validation / telemetry / renderer;
 * `toModelOutput` decides the next-turn tool-result message shape.
 *
 * Phase 1A: text → `{ type: 'text', value }` (line-numbered body + a
 * pagination tail when more is available). Errors → `{ type: 'error-text' }`
 * so providers can surface them as failed tool calls in their UI / retry
 * paths instead of as normal results.
 *
 * Phase 1B will extend this with `{ type: 'content', value: [...] }`
 * branches emitting `media` / `file-data` blocks — multimodal models
 * can't consume base64 inside JSON output (they'd see a long string).
 * When that lands, this function is the right place to extract into a
 * sibling file.
 */
function fsReadToModelOutput({
  output
}: {
  toolCallId: string
  input: unknown
  output: FsReadOutput
}): { type: 'text'; value: string } | { type: 'error-text'; value: string } {
  if (output.kind === 'error') {
    return { type: 'error-text', value: `[Error: ${output.code}] ${output.message}` }
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
- Lines longer than ${MAX_LINE_LENGTH} characters are truncated with \`...\`

Phase 1A scope: text and code files (binary detection refuses images / PDFs / archives etc. — those return an \`error\` with \`code: 'binary'\`).`,
  inputSchema,
  outputSchema,
  toModelOutput: fsReadToModelOutput,
  needsApproval: makeNeedsApproval(FS_READ_TOOL_NAME),
  execute: async ({ path: requestedPath, offset, limit }) => {
    if (!isAbsolute(requestedPath)) {
      return {
        kind: 'error' as const,
        code: 'relative-path' as const,
        message: `Path must be absolute. Got: ${requestedPath}`
      }
    }

    const absolutePath = resolve(requestedPath)

    try {
      const stats = await fs.stat(absolutePath)
      if (!stats.isFile()) {
        return {
          kind: 'error' as const,
          code: 'not-a-file' as const,
          message: `Path is not a file: ${absolutePath}`
        }
      }
    } catch (err) {
      return {
        kind: 'error' as const,
        code: 'not-found' as const,
        message: err instanceof Error ? err.message : String(err)
      }
    }

    if (await isBinary(absolutePath)) {
      return {
        kind: 'error' as const,
        code: 'binary' as const,
        message: `Cannot read binary file: ${absolutePath}. Image / PDF / Office support arrives in follow-up phases.`
      }
    }

    const content = await readTextFileWithAutoEncoding(absolutePath)
    const lines = content.split('\n')
    const totalLines = lines.length

    const startIndex = Math.max(0, (offset ?? 1) - 1)
    const pageLimit = limit ?? DEFAULT_READ_LIMIT
    const endIndex = Math.min(startIndex + pageLimit, totalLines)
    const slice = lines.slice(startIndex, endIndex)

    const formatted = slice
      .map((line, i) => {
        const lineNo = String(startIndex + i + 1).padStart(6, ' ')
        const truncated = line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}...` : line
        return `${lineNo}\t${truncated}`
      })
      .join('\n')

    return {
      kind: 'text' as const,
      text: formatted,
      startLine: startIndex + 1,
      endLine: endIndex,
      totalLines
    }
  }
}) as Tool

export function createReadFileToolEntry(): ToolEntry {
  return {
    name: FS_READ_TOOL_NAME,
    namespace: BuiltinToolNamespace.Fs,
    description: 'Read a text/code file by absolute path with line-numbered pagination',
    defer: ToolDefer.Never,
    capability: ToolCapability.Read,
    tool: fsReadTool,
    // Read-only tool — L3 always-allow. User can still add an explicit
    // deny rule at L2 (e.g. to forbid reading paths under `/etc`).
    checkPermissions: () => ({ behavior: 'allow' })
  }
}
