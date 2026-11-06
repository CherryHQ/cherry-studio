import { sha256Hex } from '../digest'
import type { GateCall, ToolResultFact } from '../facts'

// Same excerpt sizes as Cherry's chat offload.
const HEAD_CHARS = 500
const TAIL_CHARS = 1000
/** Twice the excerpts, so the marker (excerpts, note and path) is always shorter than the output. */
export const MIN_OFFLOAD_CHARS = 2 * (HEAD_CHARS + TAIL_CHARS)
const READ_TOOL = 'read'

/** The content-addressed file name of `text`, the same on every harness (P5, D31). */
export const offloadName = (text: string): string => `tool-output-${sha256Hex(text).slice(0, 16)}.txt`

/** Whether `text` passes the threshold (and the 3000-character floor), so its full text goes to the output store. */
export const exceedsThreshold = (text: string, threshold: number): boolean =>
  text.length > Math.max(threshold, MIN_OFFLOAD_CHARS)

/**
 * D31: the file a tool result is saved as, or `undefined` to keep it. Errors stay readable; nested calls reach the
 * model only through their caller; `read` results are exempt so reading an offloaded output back cannot offload it.
 */
export function offloadPlan(
  call: Pick<GateCall, 'tool' | 'nested'>,
  result: ToolResultFact,
  threshold: number
): string | undefined {
  if (result.isError || call.nested || call.tool === READ_TOOL) return undefined
  return exceedsThreshold(result.text, threshold) ? offloadName(result.text) : undefined
}

function snap(content: string, index: number, edge: 'head' | 'tail'): number {
  const newline = edge === 'head' ? content.lastIndexOf('\n', index) : content.indexOf('\n', index)
  return newline === -1 ? index : newline + 1
}
/** What the model gets instead of `content`: its head and tail around a note saying where the rest is, or why it is gone. */
export function offloadMarker(content: string, saved: { readonly path: string } | { readonly error: string }): string {
  const head = content.slice(0, snap(content, HEAD_CHARS, 'head'))
  const tail = content.slice(snap(content, content.length - TAIL_CHARS, 'tail'))
  const lines = content.split('\n').length
  const note =
    'path' in saved
      ? [
          `Full output saved to: ${saved.path}`,
          `Read the full content with the ${READ_TOOL} tool (pass the path above; page with offset/limit).`
        ]
      : [`The full output could not be saved (${saved.error}); only the excerpts shown here are available.`]
  return [
    head,
    '<persisted-output>',
    `output truncated (${lines} lines, ${content.length} chars total; first ${head.length} chars shown above, last ${tail.length} chars shown below)`,
    ...note,
    '</persisted-output>',
    tail
  ].join('\n')
}

/** D33: a summary the host's summarizer returned empty cancels the compaction; there is no fallback to the session model. */
export const summaryDecision = (summary: string): { readonly summary: string } | { readonly decline: true } =>
  summary.trim() ? { summary } : { decline: true }
