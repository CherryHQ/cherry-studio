/**
 * `fs__find` tool — fuzzy filename / path search backed by `@ff-labs/fff-node`.
 *
 * The model passes a project root + a query string; the tool returns the
 * top N matching files ranked by fff's frecency-aware fuzzy score.
 *
 * Lives under the `fs` namespace alongside `fs__read` / `fs__patch` / `fs__grep`
 * — they're all filesystem operations from the model's perspective.
 *
 * Path policy mirrors `fs__read`: `basePath` must be absolute.
 */

import { isAbsolute, resolve } from 'node:path'

import type { FileFinder } from '@ff-labs/fff-node'
import { makeNeedsApproval } from '@main/services/toolApproval/needsApproval'
import { type Tool, tool } from 'ai'
import * as z from 'zod'

import { BuiltinToolNamespace, ToolCapability, ToolDefer, type ToolEntry } from '../../types'
import { getFinder } from './finderPool'

export const FS_FIND_TOOL_NAME = 'fs__find'

const DEFAULT_LIMIT = 50

const inputSchema = z.object({
  basePath: z.string().min(1).describe('Absolute path to the project root that fff should index.'),
  query: z.string().min(1).describe('Fuzzy filename / path query (e.g. "ReadFile.tsx", "main"). Supports typos.'),
  limit: z.number().int().min(1).max(500).optional().describe(`Maximum results to return. Default: ${DEFAULT_LIMIT}.`)
})

const outputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('matches'),
    items: z.array(
      z.object({
        relativePath: z.string(),
        fileName: z.string(),
        score: z.number().optional()
      })
    ),
    truncated: z.boolean()
  }),
  z.object({
    kind: z.literal('error'),
    code: z.enum(['relative-path', 'init-failed', 'search-failed']),
    message: z.string()
  })
])

type FindPathOutput = z.infer<typeof outputSchema>

function findPathToModelOutput({
  output
}: {
  toolCallId: string
  input: unknown
  output: FindPathOutput
}): { type: 'text'; value: string } | { type: 'error-text'; value: string } {
  if (output.kind === 'error') {
    return { type: 'error-text', value: `[Error: ${output.code}] ${output.message}` }
  }
  if (output.items.length === 0) {
    return { type: 'text', value: '(no matches)' }
  }
  const lines = output.items.map((m) => m.relativePath)
  if (output.truncated) lines.push(`... (truncated; widen the query or raise limit to see more)`)
  return { type: 'text', value: lines.join('\n') }
}

const findPathTool = tool({
  description: `Find files by fuzzy name / path match.

Use this when:
- The user mentions a file by partial / approximate name and you need its actual path
- You're exploring a codebase and want to locate likely entry points

Backed by fff (frecency-ranked, typo-tolerant). Files the user has touched recently rank higher.

basePath must be absolute. Results are paths relative to basePath.`,
  inputSchema,
  outputSchema,
  toModelOutput: findPathToModelOutput,
  needsApproval: makeNeedsApproval(FS_FIND_TOOL_NAME),
  execute: async ({ basePath, query, limit }): Promise<FindPathOutput> => {
    if (!isAbsolute(basePath)) {
      return { kind: 'error', code: 'relative-path', message: `basePath must be absolute. Got: ${basePath}` }
    }
    const root = resolve(basePath)
    const pageSize = limit ?? DEFAULT_LIMIT

    let finder: FileFinder
    try {
      finder = await getFinder(root)
    } catch (err) {
      return { kind: 'error', code: 'init-failed', message: err instanceof Error ? err.message : String(err) }
    }

    const result = finder.fileSearch(query, { pageSize, pageIndex: 0 })
    if (!result.ok) {
      return { kind: 'error', code: 'search-failed', message: result.error }
    }
    const items = result.value.items.map(
      (it: { relativePath: string; fileName: string; totalFrecencyScore: number }) => ({
        relativePath: it.relativePath,
        fileName: it.fileName,
        score: it.totalFrecencyScore
      })
    )
    return {
      kind: 'matches',
      items,
      truncated: items.length >= pageSize
    }
  }
}) as Tool

export function createFindPathToolEntry(): ToolEntry {
  return {
    name: FS_FIND_TOOL_NAME,
    namespace: BuiltinToolNamespace.Fs,
    description: 'Fuzzy filename / path search via fff. Frecency-ranked, typo-tolerant.',
    defer: ToolDefer.Auto,
    capability: ToolCapability.Read,
    tool: findPathTool,
    checkPermissions: () => ({ behavior: 'allow' })
  }
}
