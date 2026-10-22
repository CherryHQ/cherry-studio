import type { AssistantMessage, JsonObject } from '@earendil-works/pi-ai'
import { Type } from '@earendil-works/pi-ai'
import { defineTool, type SessionEntry } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import type { AgentRuntimeEvent } from '../src'
import type { ModelCall } from './sessionSupport'
import { respondingModel as nativeModel } from './sessionSupport'
import { assistantReply, createTestSession, hostStore, plain } from './sessionSupport'

/** Agent requests follow `script`; requests without tools are Pi's own compaction summaries. */
function respondingModel(script: (call: number) => AssistantMessage) {
  const agentCalls: ModelCall[] = []
  const { model } = nativeModel((options) => {
    const summary = (options.tools ?? []).length === 0
    if (!summary) agentCalls.push(options)
    return summary ? assistantReply('Summary: CI was set up.') : script(agentCalls.length)
  })
  return { model, agentCalls }
}

const recall = (id: string, input: JsonObject): AssistantMessage =>
  assistantReply([{ type: 'toolCall', id: id, name: 'vcc_recall', arguments: input }], 'toolUse')
const reply = (text: string) => assistantReply([{ type: 'text', text: text }])

const recallOutputs = (entries: readonly SessionEntry[]) =>
  entries.flatMap((entry) => {
    if (entry.type !== 'message' || entry.message.role !== 'toolResult') return []
    return entry.message.toolName === 'vcc_recall'
      ? entry.message.content.flatMap((part) => (part.type === 'text' ? [part.text] : []))
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
      stream: first.model,
      compaction: { reserveTokens: 16_384, keepRecentTokens: 1 },
      recall: true,
      onEvent: host.onEvent
    })
    await session.prompt('The deploy password hint is BLUE-HERON')
    await session.prompt('Now set up CI')
    await session.compact()
    await session.prompt('What was the password hint?')

    expect(JSON.stringify(first.agentCalls[2].messages)).not.toContain('BLUE-HERON')
    const [found] = recallOutputs(host.entries)
    expect(found).toContain('#0 [user] The deploy password hint is BLUE-HERON')

    const index = Number(/#(\d+) \[user\] The deploy/.exec(found)![1])
    const second = respondingModel(
      (call) => [recall('recall_2', { expand: [index] }), reply('Still BLUE-HERON.')][call - 1]
    )
    const rebuiltHost = hostStore()
    const rebuilt = await createTestSession({
      stream: second.model,
      recall: true,
      entries: plain(host.entries),
      onEvent: rebuiltHost.onEvent
    })
    await rebuilt.session.prompt('Show me that entry in full')

    expect(recallOutputs(rebuiltHost.entries)).toEqual([`#${index} [user] The deploy password hint is BLUE-HERON`])
  })

  it('numbers entries of the running turn the way they are numbered once the host stores them', async () => {
    const committed: SessionEntry[] = []
    const pending: SessionEntry[] = []
    // This host writes a turn's entries only when the turn completes.
    const onEvent = (event: AgentRuntimeEvent) => {
      if (event.type === 'session-append') pending.push(...plain(event.entries))
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
          assistantReply(
            [{ type: 'toolCall', id: 'call_lookup', name: 'lookup_order', arguments: {} }],
            'toolUse'
          ) satisfies AssistantMessage,
          recall('recall_1', { query: 'ORDER-7731' }),
          reply('Shipped.')
        ][call - 1]
    )
    const { session } = await createTestSession({
      stream: first.model,
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
      stream: second.model,
      tools: [lookup],
      recall: true,
      entries: [...committed],
      onEvent: rebuiltHost.onEvent
    })
    await rebuilt.session.prompt('Show that order entry')

    expect(recallOutputs(rebuiltHost.entries)).toEqual([`#${index} [tool_result:lookup_order] ORDER-7731 shipped`])
  })
})
