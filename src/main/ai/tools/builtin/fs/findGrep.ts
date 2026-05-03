/**
 * `find__grep` tool — content search backed by `@ff-labs/fff-node`'s grep.
 *
 * fff's grep walks files in frecency order, supports plain / fuzzy / regex
 * modes, smart-case, before/after context, and pagination via opaque cursor
 * (cursor pagination not exposed in this version — limit is per-call only).
 *
 * Path policy mirrors `find__path`: `basePath` must be absolute.
 */

import { isAbsolute, resolve } from 'node:path'

import type { FileFinder, GrepMatch } from '@ff-labs/fff-node'
import { makeNeedsApproval } from '@main/services/toolApproval/needsApproval'
import { type Tool, tool } from 'ai'
import * as z from 'zod'

import { BuiltinToolNamespace, ToolCapability, ToolDefer, type ToolEntry } from '../../types'
import { getFinder } from './finderPool'

export const FS_GREP_TOOL_NAME = 'fs__grep'

const DEFAULT_LIMIT = 100
const DEFAULT_MAX_PER_FILE = 5

const inputSchema = z.object({
  basePath: z.string().min(1).describe('Absolute path to the project root to search.'),
  pattern: z.string().min(1).describe('Search pattern (literal / regex / fuzzy depending on mode).'),
  mode: z.enum(['plain', 'fuzzy', 'regex']).optional().describe('Search mode. Default: plain.'),
  smartCase: z
    .boolean()
    .optional()
    .describe('Case-insensitive when query is all lowercase, case-sensitive otherwise. Default: true.'),
  beforeContext: z.number().int().min(0).max(20).optional().describe('Lines of context before each match. Default: 0.'),
  afterContext: z.number().int().min(0).max(20).optional().describe('Lines of context after each match. Default: 0.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe(`Maximum total matches to return. Default: ${DEFAULT_LIMIT}.`),
  maxMatchesPerFile: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe(`Maximum matches collected per file. Default: ${DEFAULT_MAX_PER_FILE}.`)
})

const outputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('matches'),
    items: z.array(
      z.object({
        relativePath: z.string(),
        lineNumber: z.number().int(),
        lineContent: z.string(),
        contextBefore: z.array(z.string()).optional(),
        contextAfter: z.array(z.string()).optional()
      })
    ),
    filesSearched: z.number().int(),
    truncated: z.boolean()
  }),
  z.object({
    kind: z.literal('error'),
    code: z.enum(['relative-path', 'init-failed', 'search-failed']),
    message: z.string()
  })
])

type FindGrepOutput = z.infer<typeof outputSchema>

function findGrepToModelOutput({
  output
}: {
  toolCallId: string
  input: unknown
  output: FindGrepOutput
}): { type: 'text'; value: string } | { type: 'error-text'; value: string } {
  if (output.kind === 'error') {
    return { type: 'error-text', value: `[Error: ${output.code}] ${output.message}` }
  }
  if (output.items.length === 0) {
    return { type: 'text', value: `(no matches; ${output.filesSearched} files searched)` }
  }
  const lines: string[] = []
  for (const m of output.items) {
    if (m.contextBefore) {
      m.contextBefore.forEach((l, i) =>
        lines.push(`${m.relativePath}:${m.lineNumber - m.contextBefore!.length + i}- ${l}`)
      )
    }
    lines.push(`${m.relativePath}:${m.lineNumber}: ${m.lineContent}`)
    if (m.contextAfter) {
      m.contextAfter.forEach((l, i) => lines.push(`${m.relativePath}:${m.lineNumber + i + 1}- ${l}`))
    }
  }
  if (output.truncated) lines.push(`... (truncated; raise limit to see more)`)
  return { type: 'text', value: lines.join('\n') }
}

const findGrepTool = tool({
  description: `Search file contents by pattern.

Modes:
- \`plain\` (default): literal substring match
- \`regex\`: full regex
- \`fuzzy\`: typo-tolerant fuzzy match

Smart-case (default on): your query is treated case-insensitive if all-lowercase, otherwise case-sensitive.

basePath must be absolute. Use \`beforeContext\` / \`afterContext\` to widen the snippet around each match.`,
  inputSchema,
  outputSchema,
  toModelOutput: findGrepToModelOutput,
  needsApproval: makeNeedsApproval(FS_GREP_TOOL_NAME),
  execute: async ({
    basePath,
    pattern,
    mode,
    smartCase,
    beforeContext,
    afterContext,
    limit,
    maxMatchesPerFile
  }): Promise<FindGrepOutput> => {
    if (!isAbsolute(basePath)) {
      return { kind: 'error', code: 'relative-path', message: `basePath must be absolute. Got: ${basePath}` }
    }
    const root = resolve(basePath)
    const cap = limit ?? DEFAULT_LIMIT

    let finder: FileFinder
    try {
      finder = await getFinder(root)
    } catch (err) {
      return { kind: 'error', code: 'init-failed', message: err instanceof Error ? err.message : String(err) }
    }

    const result = finder.grep(pattern, {
      mode,
      smartCase,
      beforeContext,
      afterContext,
      maxMatchesPerFile: maxMatchesPerFile ?? DEFAULT_MAX_PER_FILE
    })
    if (!result.ok) {
      return { kind: 'error', code: 'search-failed', message: result.error }
    }
    const truncated = result.value.items.length > cap
    const items = result.value.items.slice(0, cap).map((it: GrepMatch) => ({
      relativePath: it.relativePath,
      lineNumber: it.lineNumber,
      lineContent: it.lineContent,
      contextBefore: it.contextBefore && it.contextBefore.length > 0 ? it.contextBefore : undefined,
      contextAfter: it.contextAfter && it.contextAfter.length > 0 ? it.contextAfter : undefined
    }))
    return {
      kind: 'matches',
      items,
      filesSearched: result.value.totalFilesSearched,
      truncated
    }
  }
}) as Tool

export function createFindGrepToolEntry(): ToolEntry {
  return {
    name: FS_GREP_TOOL_NAME,
    namespace: BuiltinToolNamespace.Fs,
    description: 'Content search via fff (plain / regex / fuzzy modes; smart-case; context lines).',
    defer: ToolDefer.Auto,
    capability: ToolCapability.Read,
    tool: findGrepTool,
    checkPermissions: () => ({ behavior: 'allow' })
  }
}
