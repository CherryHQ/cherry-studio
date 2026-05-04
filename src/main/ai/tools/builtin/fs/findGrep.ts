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
import { getFinder } from '@main/services/fileFinder/finderPool'
import { makeNeedsApproval } from '@main/services/toolApproval/needsApproval'
import { type Tool, tool } from 'ai'
import * as z from 'zod'

import { BuiltinToolNamespace, ToolCapability, ToolDefer, type ToolEntry } from '../../types'

export const FS_GREP_TOOL_NAME = 'fs__grep'

const DEFAULT_LIMIT = 100
const DEFAULT_MAX_PER_FILE = 5

const inputSchema = z.object({
  basePath: z.string().min(1).describe('Absolute path to the project root to search.'),
  pattern: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .describe(
      'Search pattern. Either a single string, or an array of strings to OR together — multi-pattern walks the fff index once via `multiGrep` when mode is "plain" (the default), or fans out per pattern for regex/fuzzy modes. Either way the index itself is built once per basePath and reused.'
    ),
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
        contextAfter: z.array(z.string()).optional(),
        /** Which input pattern matched this line. Only set when called with multiple patterns. */
        matchedPattern: z.string().optional()
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
    const tag = m.matchedPattern ? ` [${m.matchedPattern}]` : ''
    lines.push(`${m.relativePath}:${m.lineNumber}:${tag} ${m.lineContent}`)
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
  inputExamples: [
    { input: { basePath: '/Users/me/project', pattern: 'useToolApprovalBridge' } },
    {
      input: {
        basePath: '/Users/me/project',
        pattern: 'TODO\\(perf\\)',
        beforeContext: 1,
        afterContext: 2,
        limit: 50
      }
    },
    {
      input: {
        basePath: '/Users/me/project',
        pattern: ['createReadFileToolEntry', 'createApplyPatchToolEntry'],
        limit: 100
      }
    }
  ],
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
    const perFile = maxMatchesPerFile ?? DEFAULT_MAX_PER_FILE
    const patterns = Array.isArray(pattern) ? pattern : [pattern]
    const isMulti = patterns.length > 1

    let finder: FileFinder
    try {
      finder = await getFinder(root)
    } catch (err) {
      return { kind: 'error', code: 'init-failed', message: err instanceof Error ? err.message : String(err) }
    }

    interface MergedMatch {
      relativePath: string
      lineNumber: number
      lineContent: string
      contextBefore?: string[]
      contextAfter?: string[]
      matchedPattern?: string
    }
    const toMerged = (it: GrepMatch, attribution?: string): MergedMatch => ({
      relativePath: it.relativePath,
      lineNumber: it.lineNumber,
      lineContent: it.lineContent,
      contextBefore: it.contextBefore && it.contextBefore.length > 0 ? it.contextBefore : undefined,
      contextAfter: it.contextAfter && it.contextAfter.length > 0 ? it.contextAfter : undefined,
      matchedPattern: attribution
    })

    // Three execute paths:
    //   - single pattern               → finder.grep (full mode support)
    //   - multi pattern + plain mode   → finder.multiGrep (native, one walk, fff dedups)
    //   - multi pattern + non-plain    → manual fan-out (need per-pattern mode handling)
    if (!isMulti) {
      const result = finder.grep(patterns[0], {
        mode,
        smartCase,
        beforeContext,
        afterContext,
        maxMatchesPerFile: perFile
      })
      if (!result.ok) return { kind: 'error', code: 'search-failed', message: result.error }
      const items = result.value.items.slice(0, cap).map((it: GrepMatch) => toMerged(it))
      return {
        kind: 'matches',
        items,
        filesSearched: result.value.totalFilesSearched,
        truncated: result.value.items.length > cap
      }
    }

    if (mode === undefined || mode === 'plain') {
      const result = finder.multiGrep({
        patterns,
        smartCase,
        beforeContext,
        afterContext,
        maxMatchesPerFile: perFile
      })
      if (!result.ok) return { kind: 'error', code: 'search-failed', message: result.error }
      // fff's multiGrep does not attribute which pattern matched; we
      // leave `matchedPattern` undefined rather than guess.
      const items = result.value.items.slice(0, cap).map((it: GrepMatch) => toMerged(it))
      return {
        kind: 'matches',
        items,
        filesSearched: result.value.totalFilesSearched,
        truncated: result.value.items.length > cap
      }
    }

    // Multi pattern + regex/fuzzy — no native multi for these modes,
    // so fan out across the cached finder. Index built once; each grep
    // is a cheap re-walk. Dedup on path:line, attribute first hit, sort.
    const seen = new Set<string>()
    const merged: MergedMatch[] = []
    let filesSearched = 0
    for (const p of patterns) {
      const result = finder.grep(p, {
        mode,
        smartCase,
        beforeContext,
        afterContext,
        maxMatchesPerFile: perFile
      })
      if (!result.ok) {
        return { kind: 'error', code: 'search-failed', message: `${p}: ${result.error}` }
      }
      filesSearched = Math.max(filesSearched, result.value.totalFilesSearched)
      for (const it of result.value.items) {
        const key = `${it.relativePath}:${it.lineNumber}`
        if (seen.has(key)) continue
        seen.add(key)
        merged.push({
          relativePath: it.relativePath,
          lineNumber: it.lineNumber,
          lineContent: it.lineContent,
          contextBefore: it.contextBefore && it.contextBefore.length > 0 ? it.contextBefore : undefined,
          contextAfter: it.contextAfter && it.contextAfter.length > 0 ? it.contextAfter : undefined,
          matchedPattern: isMulti ? p : undefined
        })
      }
    }

    // Stable sort by path then lineNumber so output isn't pattern-order-dependent.
    merged.sort((a, b) => {
      if (a.relativePath !== b.relativePath) return a.relativePath.localeCompare(b.relativePath)
      return a.lineNumber - b.lineNumber
    })

    const truncated = merged.length > cap
    return {
      kind: 'matches',
      items: merged.slice(0, cap),
      filesSearched,
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
