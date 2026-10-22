import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { AssistantMessage, JsonObject } from '@earendil-works/pi-ai'
import type { Message, ToolCall } from '@earendil-works/pi-ai'
import { Type, type ToolResultMessage } from '@earendil-works/pi-ai'
import { defineTool, type SessionEntry } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import type { ToolOutputStore } from '../src'
import { messageText, respondingModel } from './sessionSupport'
import { assistantReply, createTestSession, hostStore, lastAssistant, MODEL, tempDir } from './sessionSupport'

const WINDOW = 9_000
const tokensOf = (prompt: Message[]) => Math.ceil(JSON.stringify(prompt).length / 4)
/** ~40k chars: alone more than the 9k-token window. */
const OUTPUT = Array.from({ length: 800 }, (_, row) => `row ${row}: ${'data '.repeat(9)}`).join('\n')

/** A provider that rejects any prompt over the window, with the error text real providers use. */
function windowedModel(window: number, script: (prompt: Message[], call: number) => AssistantMessage) {
  return respondingModel((options, call) => {
    const tokens = tokensOf(options.messages)
    if (tokens > window)
      throw new Error(
        `This model's maximum context length is ${window} tokens. However, your messages resulted in ${tokens} tokens.`
      )
    return script(options.messages, call)
  })
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

const toolCall = (id: string, toolName: string, input: JsonObject): ToolCall => ({
  type: 'toolCall',
  id: id,
  name: toolName,
  arguments: input
})

const toolEntries = (entries: SessionEntry[]) =>
  entries.flatMap((entry) => (entry.type === 'message' && entry.message.role === 'toolResult' ? [entry.message] : []))

const resultText = (message: ToolResultMessage) =>
  message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')

describe('tool output offload', () => {
  it('keeps a tool result larger than the context window from ending the turn', async () => {
    expect(OUTPUT.length / 4).toBeGreaterThan(WINDOW)
    const { model, calls } = windowedModel(WINDOW, (_prompt, call) =>
      call === 1
        ? assistantReply([toolCall('call_dump', 'dump_table', {})], 'toolUse')
        : assistantReply([{ type: 'text', text: 'The table has 800 rows.' }])
    )
    const host = hostStore()
    const structured: unknown[] = []
    const { session } = await createTestSession({
      stream: model,
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
    expect(Math.max(...calls.map((call) => tokensOf(call.messages)))).toBeLessThanOrEqual(WINDOW)
    const [stored] = toolEntries(host.entries)
    expect(stored).toMatchObject({ role: 'toolResult', content: [expect.objectContaining({ type: 'text' })] })
    const marker = resultText(stored)
    expect(marker).toContain('Read the full content with the read tool')
    expect(marker.length).toBeLessThan(3_000)
    expect(readFileSync(/Full output saved to: (.+)/.exec(marker)![1], 'utf8')).toBe(OUTPUT)
    const sent = calls[1].messages.find((message) => message.role === 'toolResult')!
    expect(messageText(sent)).toBe(marker)
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
        return assistantReply(
          [
            toolCall('call_a', 'dump_table', {}),
            toolCall('call_b', 'dump_table', {}),
            toolCall('call_c', 'fail_loudly', {})
          ],
          'toolUse'
        )
      if (call === 2) {
        const saved = /Full output saved to: ([^\s\\]+)/.exec(JSON.stringify(prompt))![1]
        return assistantReply([toolCall('call_read', 'read', { path: saved })], 'toolUse')
      }
      return assistantReply([{ type: 'text', text: 'Read it back.' }])
    })
    const dir = tempDir('offload')
    const host = hostStore()
    const { session } = await createTestSession({
      stream: model,
      model: { ...MODEL, contextWindow: 100_000 },
      tools: [dumpTable, failing],
      builtinTools: ['read'],
      offload: { store: fileStore(dir), thresholdChars: 20_000 },
      onEvent: host.onEvent
    })
    await session.prompt('Dump the table twice, fail, then read the dump back')

    const [first, second, failure, read] = toolEntries(host.entries)
    expect(second.content).toEqual(first.content)
    expect(readdirSync(dir)).toHaveLength(1)
    expect(failure.isError).toBe(true)
    expect(resultText(failure).length).toBeGreaterThan(20_000)
    expect(read.toolName).toBe('read')
    expect(resultText(read)).toContain('row 799:')
    expect(resultText(read)).not.toContain('<persisted-output>')
    expect(lastAssistant(session).stopReason).toBe('stop')
  })

  it('still keeps an oversized result out of the context when the store cannot save it', async () => {
    const { model, calls } = windowedModel(WINDOW, (_prompt, call) =>
      call === 1
        ? assistantReply([toolCall('call_dump', 'dump_table', {})], 'toolUse')
        : assistantReply([{ type: 'text', text: 'I only see part of it.' }])
    )
    const store: ToolOutputStore = {
      async save() {
        throw new Error('disk full')
      }
    }
    const { session } = await createTestSession({
      stream: model,
      model: { ...MODEL, contextWindow: WINDOW },
      tools: [dumpTable],
      offload: { store, thresholdChars: 20_000 }
    })
    await session.prompt('Dump the table')

    expect(lastAssistant(session).stopReason).toBe('stop')
    const sent = calls[1].messages.find((message) => message.role === 'toolResult')!
    const marker = messageText(sent)
    expect(marker).toContain('disk full')
    expect(marker).not.toContain('Full output saved to')
    expect(marker.length).toBeLessThan(3_000)
  })

  // Breaks when an offloaded result glues its text parts together, unlike the result the model would get.
  it('keeps the separators between text parts in the saved output and its excerpts', async () => {
    const records = Array.from({ length: 100 }, (_, i) => `record ${i}: ${'x'.repeat(40)}`)
    const listRecords = defineTool({
      name: 'list_records',
      label: 'List records',
      description: 'One text part per record',
      parameters: Type.Object({}),
      async execute() {
        return { content: records.map((text) => ({ type: 'text' as const, text })), details: undefined }
      }
    })
    const { model, calls } = windowedModel(100_000, (_prompt, call) =>
      call === 1
        ? assistantReply([toolCall('call_list', 'list_records', {})], 'toolUse')
        : assistantReply([{ type: 'text', text: 'Done.' }])
    )
    const { session } = await createTestSession({
      stream: model,
      model: { ...MODEL, contextWindow: 100_000 },
      tools: [listRecords],
      offload: { store: fileStore(tempDir('offload')), thresholdChars: 1_000 }
    })
    await session.prompt('List the records')

    const sent = calls[1].messages.find((message) => message.role === 'toolResult')!
    const marker = messageText(sent)
    expect(readFileSync(/Full output saved to: (.+)/.exec(marker)![1], 'utf8')).toBe(records.join('\n'))
    expect(marker).toContain(`${records[0]}\n${records[1]}\n`)
    expect(marker).toContain(`\n${records[98]}\n${records[99]}`)
  })

  it('sends an output whole when its marker would not be shorter', async () => {
    const output = 'x'.repeat(2_000)
    const echo = defineTool({
      name: 'echo_block',
      label: 'Echo',
      description: 'Returns a block of text',
      parameters: Type.Object({}),
      async execute() {
        return { content: [{ type: 'text', text: output }], details: undefined }
      }
    })
    const { model, calls } = windowedModel(100_000, (_prompt, call) =>
      call === 1
        ? assistantReply([toolCall('call_echo', 'echo_block', {})], 'toolUse')
        : assistantReply([{ type: 'text', text: 'Done.' }])
    )
    const dir = tempDir('offload')
    const { session } = await createTestSession({
      stream: model,
      model: { ...MODEL, contextWindow: 100_000 },
      tools: [echo],
      offload: { store: fileStore(dir), thresholdChars: 1_000 }
    })
    await session.prompt('Echo the block')

    const sent = calls[1].messages.find((message) => message.role === 'toolResult')!
    expect(messageText(sent)).toBe(output)
    expect(readdirSync(dir)).toEqual([])
  })
})
