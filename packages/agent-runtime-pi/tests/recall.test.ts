import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it } from 'vitest'

import type { AgentRuntimeEvent, TranscriptEntry } from '../src'
import { createTestSession, finish, hostStore, plain, streamTextPort, textParts } from './support'

/** Agent requests follow `script`; requests without tools are Pi's own compaction summaries. */
function respondingModel(script: (call: number) => LanguageModelV3StreamPart[]) {
  const agentCalls: LanguageModelV3CallOptions[] = []
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      const summary = (options.tools ?? []).length === 0
      if (!summary) agentCalls.push(options)
      const chunks = summary
        ? [...textParts('s', 'Summary: CI was set up.'), finish('stop')]
        : script(agentCalls.length)
      return { stream: simulateReadableStream({ chunks }) }
    }
  })
  return { model, agentCalls }
}

const recall = (id: string, input: object): LanguageModelV3StreamPart[] => [
  { type: 'tool-call', toolCallId: id, toolName: 'vcc_recall', input: JSON.stringify(input) },
  finish('tool-calls')
]
const reply = (text: string) => [...textParts('t', text), finish('stop')]

const recallOutputs = (entries: readonly TranscriptEntry[]) =>
  entries.flatMap((entry) => {
    if (entry.kind !== 'message' || entry.message.role !== 'tool') return []
    const [part] = entry.message.content
    return part.type === 'tool-result' && part.toolName === 'vcc_recall' && part.output.type === 'text'
      ? [part.output.value]
      : []
  })

describe('vcc_recall', () => {
  it('finds what compaction folded away and expands it by the same #N after a rebuild', async () => {
    const host = hostStore()
    const first = respondingModel(
      (call) =>
        [
          reply('Noted.'),
          reply('CI is ready.'),
          recall('recall_1', { query: 'password hint' }),
          reply('It is BLUE-HERON.')
        ][call - 1]
    )
    const { session } = await createTestSession({
      port: streamTextPort(first.model).port,
      compaction: { reserveTokens: 16_384, keepRecentTokens: 1 },
      recall: true,
      onEvent: host.onEvent
    })
    await session.prompt('The deploy password hint is BLUE-HERON')
    await session.prompt('Now set up CI')
    await session.compact()
    await session.prompt('What was the password hint?')

    expect(JSON.stringify(first.agentCalls[2].prompt)).not.toContain('BLUE-HERON')
    const [found] = recallOutputs(host.entries)
    expect(found).toContain('#0 [user] The deploy password hint is BLUE-HERON')

    const index = Number(/#(\d+) \[user\] The deploy/.exec(found)![1])
    const second = respondingModel(
      (call) => [recall('recall_2', { expand: [index] }), reply('Still BLUE-HERON.')][call - 1]
    )
    const rebuiltHost = hostStore()
    const rebuilt = await createTestSession({
      port: streamTextPort(second.model).port,
      recall: true,
      transcript: plain(host.entries),
      onEvent: rebuiltHost.onEvent
    })
    await rebuilt.session.prompt('Show me that entry in full')

    expect(recallOutputs(rebuiltHost.entries)).toEqual([`#${index} [user] The deploy password hint is BLUE-HERON`])
  })

  it('numbers entries of the running turn the way they are numbered once the host stores them', async () => {
    const committed: TranscriptEntry[] = []
    const pending: TranscriptEntry[] = []
    // This host writes a turn's entries only when the turn completes.
    const onEvent = (event: AgentRuntimeEvent) => {
      if (event.type === 'transcript-append') pending.push(...plain(event.entries))
      if (event.type === 'turn-complete') committed.push(...pending.splice(0))
    }
    const lookup = defineTool({
      name: 'lookup_order',
      label: 'Order',
      description: 'Look up an order',
      parameters: Type.Object({}),
      async execute() {
        return { content: [{ type: 'text', text: 'ORDER-7731 shipped' }], details: undefined }
      }
    })
    const first = respondingModel(
      (call) =>
        [
          [
            { type: 'tool-call', toolCallId: 'call_lookup', toolName: 'lookup_order', input: '{}' },
            finish('tool-calls')
          ] satisfies LanguageModelV3StreamPart[],
          recall('recall_1', { query: 'ORDER-7731' }),
          reply('Shipped.')
        ][call - 1]
    )
    const { session } = await createTestSession({
      port: streamTextPort(first.model).port,
      tools: [lookup],
      recall: true,
      onEvent
    })
    await session.prompt('Where is my order?')

    const [found] = recallOutputs(committed)
    const index = Number(/#(\d+) \[tool_result:lookup_order\] ORDER-7731 shipped/.exec(found)![1])

    const second = respondingModel((call) => [recall('recall_2', { expand: [index] }), reply('ok')][call - 1])
    const rebuiltHost = hostStore()
    const rebuilt = await createTestSession({
      port: streamTextPort(second.model).port,
      tools: [lookup],
      recall: true,
      transcript: [...committed],
      onEvent: rebuiltHost.onEvent
    })
    await rebuilt.session.prompt('Show that order entry')

    expect(recallOutputs(rebuiltHost.entries)).toEqual([`#${index} [tool_result:lookup_order] ORDER-7731 shipped`])
  })
})
