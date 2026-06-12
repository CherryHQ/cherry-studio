/**
 * fs__read — read-back companion for the context-build persistence layer.
 * Ported from PR #14916's `fs/readFile.ts`, reduced to text-only and
 * re-scoped from any-absolute-path to strict root containment
 * (decision 2026-06-12): allowed roots are the VFS persisted-output dir
 * (always) plus a workspace root when a request carries one — today's
 * aiSdk chat runtime has none, so chat is effectively VFS-only.
 */
import fsp from 'node:fs/promises'
import { isAbsolute } from 'node:path'

import { application } from '@application'
import { validatePath } from '@main/ai/mcp/servers/filesystem/types'
import { readTextFileWithAutoEncoding } from '@main/utils/file'
import { FS_READ_TOOL_NAME } from '@shared/ai/builtinTools'
import { tool } from 'ai'
import * as z from 'zod'

import type { ToolEntry } from '../types'

const MB = 1024 * 1024
/** Whole-file reads above this are rejected; paging args bypass the cap. */
const SIZE_CAP_BYTES = 5 * MB
/**
 * Max chars returned per call. Above this the tool returns a structured
 * error with a file-specific recommended `limit` — fs__read must handle
 * its own oversize natively (it is `truncatable: false`; letting the
 * persistence layer store an fs__read result would loop: persisted file
 * → fs__read → still too large → persist again).
 * Matches the persistence threshold so the model sees one boundary.
 */
const READ_OUTPUT_CHAR_CAP = 100_000
const DEFAULT_READ_LIMIT = 2_000
const MAX_LINE_LENGTH = 2_000

const inputSchema = z.object({
  path: z.string().min(1).describe('Absolute file path. Relative paths are rejected.'),
  offset: z.number().int().min(1).optional().describe('1-indexed line number to start reading at. Default: 1.'),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      `Maximum number of lines to return. Default: ${DEFAULT_READ_LIMIT}. No schema upper bound — ` +
        `the per-call output cap (${READ_OUTPUT_CHAR_CAP} chars) is the real gate.`
    )
})

const outputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    text: z.string(),
    startLine: z.number().int(),
    endLine: z.number().int(),
    totalLines: z.number().int()
  }),
  z.object({
    kind: z.literal('error'),
    code: z.enum([
      'relative-path',
      'access-denied',
      'not-found',
      'not-a-file',
      'binary',
      'too-large',
      'output-too-large',
      'parse-error'
    ]),
    message: z.string()
  })
])

export type FsReadOutput = z.infer<typeof outputSchema>

/** Allowed containment roots. Grows a workspace root when the chat
 *  runtime gains one (P2-B+); resolved lazily — the path registry and
 *  VfsBlobService are not ready at module import. */
function allowedRoots(): string[] {
  return [application.get('VfsBlobService').getRoot()]
}

/** validatePath per root (realpath + containment, same semantics as the
 *  filesystem MCP server); first root that admits the path wins. */
async function resolveWithinAllowedRoots(requestedPath: string): Promise<string | null> {
  for (const root of allowedRoots()) {
    try {
      return await validatePath(requestedPath, root)
    } catch {
      // Outside this root — try the next.
    }
  }
  return null
}

async function isBinaryContent(absolutePath: string): Promise<boolean> {
  const handle = await fsp.open(absolutePath, 'r')
  try {
    const probe = Buffer.alloc(8192)
    const { bytesRead } = await handle.read(probe, 0, probe.length, 0)
    return probe.subarray(0, bytesRead).includes(0)
  } finally {
    await handle.close()
  }
}

interface TextReadResult {
  text: string
  startLine: number
  endLine: number
  totalLines: number
}

/** cat -n shape: 6-pad line numbers + tab; long lines truncated. Ported
 *  from #14916's readers/text.ts — the model pattern-matches this format. */
function formatLines(content: string, offset: number | undefined, limit: number | undefined): TextReadResult {
  const lines = content.split('\n')
  const totalLines = lines.length
  const startIndex = Math.max(0, (offset ?? 1) - 1)
  const endIndex = Math.min(startIndex + (limit ?? DEFAULT_READ_LIMIT), totalLines)
  const text = lines
    .slice(startIndex, endIndex)
    .map((line, i) => {
      const lineNo = String(startIndex + i + 1).padStart(6, ' ')
      const body = line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}...` : line
      return `${lineNo}\t${body}`
    })
    .join('\n')
  return { text, startLine: startIndex + 1, endLine: endIndex, totalLines }
}

/** Exported for direct testing (the tool's execute delegates here). */
export async function executeFsRead(input: { path: string; offset?: number; limit?: number }): Promise<FsReadOutput> {
  const { path: requestedPath, offset, limit } = input

  if (!isAbsolute(requestedPath)) {
    return { kind: 'error', code: 'relative-path', message: `Path must be absolute. Got: ${requestedPath}` }
  }

  const absolutePath = await resolveWithinAllowedRoots(requestedPath)
  if (!absolutePath) {
    return {
      kind: 'error',
      code: 'access-denied',
      message: 'Access denied: path is outside the allowed roots (persisted-output directory).'
    }
  }

  let stats: Awaited<ReturnType<typeof fsp.stat>>
  try {
    stats = await fsp.stat(absolutePath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return { kind: 'error', code: 'not-found', message: `File not found: ${requestedPath}` }
    }
    return { kind: 'error', code: 'parse-error', message: err instanceof Error ? err.message : String(err) }
  }

  if (!stats.isFile()) {
    return { kind: 'error', code: 'not-a-file', message: `Not a regular file: ${requestedPath}` }
  }

  const hasPagingArgs = offset !== undefined || limit !== undefined
  if (!hasPagingArgs && stats.size > SIZE_CAP_BYTES) {
    return {
      kind: 'error',
      code: 'too-large',
      message:
        `File is ${stats.size} bytes (cap ${SIZE_CAP_BYTES} for whole-file reads). ` +
        `Pass \`offset\`/\`limit\` to page through it.`
    }
  }

  try {
    if (await isBinaryContent(absolutePath)) {
      return { kind: 'error', code: 'binary', message: `Cannot read binary file: ${requestedPath}` }
    }

    const content = await readTextFileWithAutoEncoding(absolutePath)
    const result = formatLines(content, offset, limit)

    if (result.text.length > READ_OUTPUT_CHAR_CAP) {
      const returnedLines = Math.max(1, result.endLine - result.startLine + 1)
      const avgPerLine = Math.max(1, Math.round(result.text.length / returnedLines))
      const safeLimit = Math.max(1, Math.floor((READ_OUTPUT_CHAR_CAP - 200) / avgPerLine))
      return {
        kind: 'error',
        code: 'output-too-large',
        message:
          `Output ${result.text.length} chars across lines ${result.startLine}-${result.endLine} of ${result.totalLines} ` +
          `(avg ~${avgPerLine} chars/line including the line-number prefix) exceeds the per-call cap (${READ_OUTPUT_CHAR_CAP}). ` +
          `For THIS file request at most \`limit: ${safeLimit}\` lines per call, stepping with \`offset\` ` +
          `(first \`offset: 1, limit: ${safeLimit}\`, then \`offset: ${safeLimit + 1}\`, …).`
      }
    }

    return { kind: 'text', ...result }
  } catch (err) {
    return { kind: 'error', code: 'parse-error', message: err instanceof Error ? err.message : String(err) }
  }
}

const fsReadTool = tool({
  description: `Read a text file by absolute path.

Primary use: retrieving the full content behind a <persisted-output> marker — call with the path shown after "Full output saved to:". Paths are restricted to allowed roots (the persisted-output directory); reads elsewhere return access-denied.

Pagination: pass \`offset\` (1-indexed line) + \`limit\` for large files; results include \`totalLines\`. Oversized pages return an \`output-too-large\` error with a file-specific recommended \`limit\`.`,
  inputSchema,
  outputSchema,
  toModelOutput: ({ output }) => {
    if (output.kind === 'error') {
      return { type: 'error-text' as const, value: `[Error: ${output.code}] ${output.message}` }
    }
    const remaining = output.totalLines - output.endLine
    const tail =
      remaining > 0
        ? `\n\n[showing lines ${output.startLine}-${output.endLine} of ${output.totalLines}; ${remaining} more — call again with offset=${output.endLine + 1} to continue]`
        : ''
    return { type: 'text' as const, value: `${output.text}${tail}` }
  },
  execute: async (input) => executeFsRead(input)
})

export function createFsReadToolEntry(): ToolEntry {
  return {
    name: FS_READ_TOOL_NAME,
    // Exempt from the context-build truncate/persist layer: fs__read
    // handles oversize natively (output-too-large + paging); persisting
    // its result would route the model back through fs__read in a loop.
    truncatable: false,
    namespace: 'fs',
    description: 'Read a text file by absolute path (persisted-output retrieval; paginated)',
    defer: 'never',
    tool: fsReadTool
  }
}
