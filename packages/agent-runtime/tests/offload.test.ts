import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { LanguageModelV3CallOptions, LanguageModelV3Prompt, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { APICallError, simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it } from 'vitest'

import type { ToolOutputStore, TranscriptMessageEntry } from '../src'
import {
  createTestSession,
  finish,
  hostStore,
  lastAssistant,
  MODEL,
  plain,
  streamTextPort,
  tempDir,
  textParts
} from './support'

const WINDOW = 9_000
const tokensOf = (prompt: LanguageModelV3Prompt) => Math.ceil(JSON.stringify(prompt).length / 4)
/** ~40k chars: alone more than the 9k-token window. */
const OUTPUT = Array.from({ length: 800 }, (_, row) => `row ${row}: ${'data '.repeat(9)}`).join('\n')

/** A provider that rejects any prompt over the window, with the error text real providers use. */
function windowedModel(
  window: number,
  script: (prompt: LanguageModelV3Prompt, call: number) => LanguageModelV3StreamPart[]
) {
  const calls: LanguageModelV3CallOptions[] = []
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      calls.push(options)
      const tokens = tokensOf(options.prompt)
      if (tokens > window)
        throw new APICallError({
          message: `This model's maximum context length is ${window} tokens. However, your messages resulted in ${tokens} tokens.`,
          url: 'https://api.example.com/v1/chat/completions',
          requestBodyValues: {},
          statusCode: 400
        })
      return { stream: simulateReadableStream({ chunks: script(options.prompt, calls.length) }) }
    }
  })
  return { model, calls }
}

/** Saves outputs as files Pi's `read` tool can open. */
function fileStore(dir: string): ToolOutputStore {
  return {
    async save({ name, content }) {
      const file = path.join(dir, name)
      writeFileSync(file, content)
      return file
    }
  }
}

const dumpTable = defineTool({
  name: 'dump_table',
  label: 'Dump table',
  description: 'Dump every row of the table',
  parameters: Type.Object({}),
  async execute() {
    return { content: [{ type: 'text', text: OUTPUT }], details: undefined, structuredContent: { rows: 800 } }
  }
})

const toolCall = (id: string, toolName: string, input: object): LanguageModelV3StreamPart => ({
  type: 'tool-call',
  toolCallId: id,
  toolName,
  input: JSON.stringify(input)
})

const toolEntries = (entries: unknown[]) =>
  (entries as TranscriptMessageEntry[]).flatMap((entry) =>
    entry.kind === 'message' && entry.message.role === 'tool' ? [entry.message.content[0]] : []
  )

describe('tool output offload', () => {
  it('keeps a tool result larger than the context window from ending the turn', async () => {
    expect(OUTPUT.length / 4).toBeGreaterThan(WINDOW)
    const { model, calls } = windowedModel(WINDOW, (_prompt, call) =>
      call === 1
        ? [toolCall('call_dump', 'dump_table', {}), finish('tool-calls')]
        : [...textParts('t', 'The table has 800 rows.'), finish('stop')]
    )
    const host = hostStore()
    const structured: unknown[] = []
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      model: { ...MODEL, contextWindow: WINDOW },
      tools: [dumpTable],
      offload: { store: fileStore(tempDir('offload')), thresholdChars: 20_000 },
      onEvent: host.onEvent
    })
    session.subscribe((event) => {
      if (event.type === 'tool_execution_end') structured.push(event.result.structuredContent)
    })
    await session.prompt('Dump the table')

    expect(lastAssistant(session)).toMatchObject({
      stopReason: 'stop',
      content: [{ type: 'text', text: 'The table has 800 rows.' }]
    })
    expect(Math.max(...calls.map((call) => tokensOf(call.prompt)))).toBeLessThanOrEqual(WINDOW)
    const [stored] = toolEntries(host.entries)
    expect(stored).toMatchObject({ type: 'tool-result', output: { type: 'text' } })
    const marker = (stored as { output: { value: string } }).output.value
    expect(marker).toContain('Read the full content with the read tool')
    expect(marker.length).toBeLessThan(3_000)
    expect(readFileSync(/Full output saved to: (.+)/.exec(marker)![1], 'utf8')).toBe(OUTPUT)
    const sent = calls[1].prompt.find((message) => message.role === 'tool')!
    expect(plain(sent.content[0])).toMatchObject({ output: { type: 'text', value: marker } })
    expect(structured).toEqual([{ rows: 800 }])
  })

  it('reuses one file and marker for the same output, and leaves errors and read results whole', async () => {
    const failing = defineTool({
      name: 'fail_loudly',
      label: 'Fail',
      description: 'Always fails with a long message',
      parameters: Type.Object({}),
      async execute() {
        throw new Error(`FAILED ${'reason '.repeat(5_000)}`)
      }
    })
    const { model } = windowedModel(100_000, (prompt, call) => {
      if (call === 1)
        return [
          toolCall('call_a', 'dump_table', {}),
          toolCall('call_b', 'dump_table', {}),
          toolCall('call_c', 'fail_loudly', {}),
          finish('tool-calls')
        ]
      if (call === 2) {
        const saved = /Full output saved to: ([^\s\\]+)/.exec(JSON.stringify(prompt))![1]
        return [toolCall('call_read', 'read', { path: saved }), finish('tool-calls')]
      }
      return [...textParts('t', 'Read it back.'), finish('stop')]
    })
    const dir = tempDir('offload')
    const host = hostStore()
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      model: { ...MODEL, contextWindow: 100_000 },
      tools: [dumpTable, failing],
      builtinTools: ['read'],
      offload: { store: fileStore(dir), thresholdChars: 20_000 },
      onEvent: host.onEvent
    })
    await session.prompt('Dump the table twice, fail, then read the dump back')

    const [first, second, failure, read] = toolEntries(host.entries) as {
      toolName: string
      output: { type: string; value: string }
    }[]
    expect(second.output).toEqual(first.output)
    expect(readdirSync(dir)).toHaveLength(1)
    expect(failure.output.type).toBe('error-text')
    expect(failure.output.value.length).toBeGreaterThan(20_000)
    expect(read.toolName).toBe('read')
    expect(read.output.value).toContain('row 799:')
    expect(read.output.value).not.toContain('<persisted-output>')
    expect(lastAssistant(session).stopReason).toBe('stop')
  })
})
