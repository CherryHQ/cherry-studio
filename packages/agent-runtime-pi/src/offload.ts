import { createHash } from 'node:crypto'

import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'

/** Host storage for tool outputs too large to send. */
export interface ToolOutputStore {
  /**
   * Saves a tool's full text output and returns a path Pi's `read` tool can open. Names are content
   * addressed: the same name always comes with the same content, so saving it again is harmless.
   */
  save(file: { name: string; content: string; toolCallId: string; toolName: string }): Promise<string>
}

export interface ToolOutputOffload {
  store: ToolOutputStore
  /** Text results longer than this many characters (and than 3000) are saved and replaced by a marker. */
  thresholdChars: number
}

// Same excerpt sizes as Cherry's chat offload.
const HEAD_CHARS = 500
const TAIL_CHARS = 1000
// Twice the excerpts, so the marker (excerpts, note and path) is always shorter than the output.
const MIN_OFFLOAD_CHARS = 2 * (HEAD_CHARS + TAIL_CHARS)
const READ_TOOL = 'read'

function snap(content: string, index: number, edge: 'head' | 'tail'): number {
  const newline = edge === 'head' ? content.lastIndexOf('\n', index) : content.indexOf('\n', index)
  return newline === -1 ? index : newline + 1
}

/** The head and tail of the output around a note saying where the rest is and how to read it. */
function offloadMarker(content: string, path: string): string {
  const head = content.slice(0, snap(content, HEAD_CHARS, 'head'))
  const tail = content.slice(snap(content, content.length - TAIL_CHARS, 'tail'))
  const lines = content.split('\n').length
  return [
    head,
    '<persisted-output>',
    `output truncated (${lines} lines, ${content.length} chars total; first ${head.length} chars shown above, last ${tail.length} chars shown below)`,
    `Full output saved to: ${path}`,
    `Read the full content with the ${READ_TOOL} tool (pass the path above; page with offset/limit).`,
    '</persisted-output>',
    tail
  ].join('\n')
}

/**
 * Saves oversized tool output through the host store and gives the model a marker instead, so one
 * result cannot overflow the context. The transcript keeps the marker: it is what the model saw.
 */
export function toolOutputOffloadExtension({ store, thresholdChars }: ToolOutputOffload): ExtensionFactory {
  return (pi) => {
    pi.on('tool_result', async (event) => {
      // Errors stay readable; nested calls reach the model only through their caller; `read`
      // results are exempt so reading an offloaded output back cannot offload it again.
      if (event.isError || event.parentToolCallId !== undefined || event.toolName === READ_TOOL) return undefined
      const text = event.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
      if (text.length <= Math.max(thresholdChars, MIN_OFFLOAD_CHARS)) return undefined
      const name = `tool-output-${createHash('sha256').update(text).digest('hex').slice(0, 16)}.txt`
      const path = await store.save({ name, content: text, toolCallId: event.toolCallId, toolName: event.toolName })
      return {
        content: [
          { type: 'text', text: offloadMarker(text, path) },
          ...event.content.filter((part) => part.type === 'image')
        ],
        ...(event.structuredContent === undefined ? {} : { structuredContent: event.structuredContent })
      }
    })
  }
}
