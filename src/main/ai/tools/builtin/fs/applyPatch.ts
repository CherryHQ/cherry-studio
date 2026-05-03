/**
 * `fs__patch` tool — apply a Codex-format patch envelope to the
 * filesystem.
 *
 * One tool covers add / update / delete across multiple files in a
 * single LLM turn. Stateless context-line verification (each hunk's
 * context lines must match the file at apply time) replaces a
 * read-before-write cache — multi-model fan-out and detached
 * sub-agents stay correct because no per-tool state is shared.
 *
 * Atomicity: the parser + applier run a validate-everything-then-commit
 * pass. If any op fails (parse error, missing file, context mismatch,
 * already-exists), no files are touched.
 *
 * Failure feedback: on context mismatch the tool surfaces the offending
 * file path, hunk index, and the first 5 actual file lines so the model
 * can re-issue a corrected patch.
 */

import { matcherRegistry } from '@main/services/toolApproval'
import { makeNeedsApproval } from '@main/services/toolApproval/needsApproval'
import { type Tool, tool } from 'ai'
import * as z from 'zod'

import { BuiltinToolNamespace, ToolCapability, ToolDefer, type ToolEntry } from '../../types'
import { type ApplyError, applyPatch as applyPatchCore } from './patch/applier'
import { parsePatch } from './patch/parser'
import { matchFsPatchRule } from './patch/ruleMatcher'

export const FS_PATCH_TOOL_NAME = 'fs__patch'

const inputSchema = z.object({
  patch: z.string().min(1).describe('The full Codex-format patch envelope, starting with "*** Begin Patch".')
})

const opSummarySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('added'), path: z.string(), lines: z.number().int() }),
  z.object({ type: z.literal('updated'), path: z.string(), hunksApplied: z.number().int() }),
  z.object({ type: z.literal('deleted'), path: z.string() })
])

const outputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('applied'),
    results: z.array(opSummarySchema)
  }),
  z.object({
    kind: z.literal('parse-error'),
    message: z.string()
  }),
  z.object({
    kind: z.literal('apply-error'),
    reason: z.enum([
      'relative-path',
      'file-not-found',
      'file-exists',
      'context-mismatch',
      'ambiguous-match',
      'io-failure'
    ]),
    path: z.string().optional(),
    hunkIndex: z.number().int().optional(),
    message: z.string(),
    /** 5-line window around the probable apply point — context-mismatch only. */
    actualContext: z.array(z.string()).optional(),
    /** 1-indexed line number of the first line in actualContext. */
    actualContextStart: z.number().int().optional(),
    /** Total lines in the target file — context-mismatch / ambiguous-match. */
    totalLines: z.number().int().optional(),
    /** How many places matched — ambiguous-match only. */
    matchCount: z.number().int().optional()
  })
])

type FsPatchOutput = z.infer<typeof outputSchema>

function fsPatchToModelOutput({
  output
}: {
  toolCallId: string
  input: unknown
  output: FsPatchOutput
}): { type: 'text'; value: string } | { type: 'error-text'; value: string } {
  if (output.kind === 'parse-error') {
    return { type: 'error-text', value: `[parse-error] ${output.message}` }
  }
  if (output.kind === 'apply-error') {
    const lines: string[] = [`[apply-error: ${output.reason}]`]
    if (output.path) lines.push(`file: ${output.path}`)
    if (output.hunkIndex !== undefined) lines.push(`hunk ${output.hunkIndex} did not match`)
    if (output.totalLines !== undefined) lines.push(`file has ${output.totalLines} lines total`)
    lines.push(output.message)
    if (output.actualContext && output.actualContext.length > 0) {
      const startLine = output.actualContextStart ?? 1
      lines.push('')
      lines.push(
        `Actual file content around the probable apply point (lines ${startLine}-${startLine + output.actualContext.length - 1}):`
      )
      output.actualContext.forEach((l, i) => lines.push(`${String(startLine + i).padStart(6, ' ')}\t${l}`))
    }
    return { type: 'error-text', value: lines.join('\n') }
  }
  if (output.results.length === 0) {
    return { type: 'text', value: 'No changes — patch had zero operations.' }
  }
  const summary = output.results.map((r) => {
    if (r.type === 'added') return `Added ${r.path} (${r.lines} lines)`
    if (r.type === 'updated') return `Updated ${r.path} (${r.hunksApplied} hunks)`
    return `Deleted ${r.path}`
  })
  return { type: 'text', value: summary.join('\n') }
}

const fsPatchTool = tool({
  description: `Apply a multi-file patch in a single call.

Format:
\`\`\`
*** Begin Patch
*** Add File: <absolute-path>
+<content lines, prefixed with +>
*** Update File: <absolute-path>
@@ <optional context anchor>
 <unchanged context line>
-<line to remove>
+<line to add>
 <unchanged context line>
*** Delete File: <absolute-path>
*** End Patch
\`\`\`

Use this for ALL file write operations — creating new files (via \`*** Add File:\`), modifying existing files (via \`*** Update File:\`), and deleting (via \`*** Delete File:\`). There is no separate "write file" tool; \`*** Add File:\` is the canonical way to create.

Atomicity: the patch is validated end-to-end before any file is touched. If one hunk fails to match, NO files change — re-issue with corrected hunks.

On context mismatch, the tool returns the first 5 actual lines of the offending file so you can adjust your hunks.

All paths must be absolute.`,
  inputSchema,
  outputSchema,
  toModelOutput: fsPatchToModelOutput,
  needsApproval: makeNeedsApproval(FS_PATCH_TOOL_NAME),
  execute: async ({ patch }): Promise<FsPatchOutput> => {
    const parsed = parsePatch(patch)
    if (!parsed.ok) {
      return { kind: 'parse-error', message: parsed.error }
    }
    const outcome = await applyPatchCore(parsed.value)
    if (!outcome.ok) {
      return toApplyErrorOutput(outcome.error)
    }
    return { kind: 'applied', results: outcome.value.results }
  }
}) as Tool

function toApplyErrorOutput(error: ApplyError): FsPatchOutput {
  return {
    kind: 'apply-error',
    reason: error.reason,
    path: error.path,
    hunkIndex: error.hunkIndex,
    message: error.message,
    actualContext: error.actualContext,
    actualContextStart: error.actualContextStart,
    totalLines: error.totalLines,
    matchCount: error.matchCount
  }
}

export function createApplyPatchToolEntry(): ToolEntry {
  // Side-effect: register the path-glob content matcher so `Edit(...)` rules
  // are evaluable at L2 / L4. Idempotent — `register` overwrites.
  matcherRegistry.register(FS_PATCH_TOOL_NAME, matchFsPatchRule)
  return {
    name: FS_PATCH_TOOL_NAME,
    namespace: BuiltinToolNamespace.Fs,
    description:
      'Apply a multi-file patch (add / update / delete) in one call. Codex envelope format. Atomic across files.',
    defer: ToolDefer.Never,
    capability: ToolCapability.Write,
    tool: fsPatchTool,
    // Write tool — defer to user rules (L4). With no rule the central
    // pipeline falls through to L5 default ('ask'), so the user is always
    // prompted unless they've added an `Edit(...)` allow rule.
    checkPermissions: () => ({ behavior: 'passthrough' })
  }
}
