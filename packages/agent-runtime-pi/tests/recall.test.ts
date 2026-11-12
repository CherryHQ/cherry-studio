import type { AssistantMessage, JsonObject } from '@earendil-works/pi-ai'
import { defineTool, type SessionEntry, SessionManager } from '@earendil-works/pi-coding-agent'
import { obj } from '@earendil-works/pi-schema'
import { describe, expect, it, onTestFinished } from 'vitest'

import { createScriptedHost, install } from '@cherrystudio/agent-behavior'

import { type AgentRuntimeEvent } from '../src'
import { createPiBehavior } from '../src/behavior/harness'
import type { TestSessionOptions } from './sessionSupport'
import { respondingModel } from './sessionSupport'
import { assistantReply, createTestSession, hostStore, plain, tempDir } from './sessionSupport'

async function createRecallSession(options: TestSessionOptions) {
  const cwd = tempDir('recall')
  const manager = SessionManager.inMemory(cwd, undefined, options.entries)
  const host = createScriptedHost({
    settings: {
      goalDefaults: { maxGoalRounds: 3, maxGoalRoundsCeiling: 50, blockedAfter: 3 },
      autonomy: 'auto',
      permissionMode: 'auto',
      attendance: 'stream',
      maxBackground: 4,
      offloadThreshold: 20_000
    }
  })
  const errors: unknown[] = []
  const behavior = createPiBehavior({
    install: (ports) => {
      install(ports, host)
    },
    openSession: ({ sessionManager, extension }) =>
      createTestSession({
        ...options,
        cwd,
        sessionManager,
        compaction: { enabled: false, reserveTokens: 1, keepRecentTokens: 1, ...options.compaction },
        extensionFactories: [extension]
      }),
    onError: (error) => {
      errors.push(error)
    }
  })
  onTestFinished(async () => {
    await behavior.close()
    expect(errors).toEqual([])
  })
  const thread = await behavior.openConversation(manager)
  return {
    session: {
      prompt: (text: string) => behavior.prompt(thread, text),
      compact: () => behavior.compact(thread)
    },
    dispose: () => behavior.close()
  }
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
  it('passes each requested entry to the model once in first-requested order', async () => {
    const host = hostStore()
    const provider = respondingModel(
      (_request, call) => [reply('Noted.'), recall('recall_1', { expand: [1, 0, 1, 0] }), reply('Done.')][call - 1]
    )
    const { session } = await createRecallSession({ stream: provider.model, onEvent: host.onEvent })
    await session.prompt('Remember this.')
    await session.prompt('Expand the earlier exchange.')

    const expected = '#1 [assistant] Noted.\n\n#0 [user] Remember this.'
    expect(recallOutputs(host.entries)).toEqual([expected])
    const results = provider.calls[2].messages.filter((message) => message.role === 'toolResult')
    expect(results).toHaveLength(1)
    expect(results[0].content).toEqual([{ type: 'text', text: expected }])
  })

  it('finds what compaction folded away and expands it by the same #N after a rebuild', async () => {
    const host = hostStore()
    const first = respondingModel(
      (_request, call) =>
        [
          reply('Noted.'),
          reply('CI is ready.'),
          reply('Summary: CI was set up.'),
          reply('Summary: the current turn.'),
          recall('recall_1', { query: 'password hint' }),
          reply('It is BLUE-HERON.')
        ][call - 1]
    )
    const { session, dispose } = await createRecallSession({
      stream: first.model,
      compaction: { reserveTokens: 16_384, keepRecentTokens: 1 },
      onEvent: host.onEvent
    })
    await session.prompt('The deploy password hint is BLUE-HERON')
    await session.prompt('Now set up CI')
    await session.compact()
    await session.prompt('What was the password hint?')

    expect(JSON.stringify(first.calls[4].messages)).not.toContain('BLUE-HERON')
    const [found] = recallOutputs(host.entries)
    expect(found).toContain('#0 [user] The deploy password hint is BLUE-HERON')

    const index = Number(/#(\d+) \[user\] The deploy/.exec(found)![1])
    const second = respondingModel(
      (_request, call) => [recall('recall_2', { expand: [index] }), reply('Still BLUE-HERON.')][call - 1]
    )
    await dispose()
    const rebuiltHost = hostStore()
    const rebuilt = await createRecallSession({
      stream: second.model,
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
      parameters: obj({}),
      async execute() {
        return { content: [{ type: 'text', text: 'ORDER-7731 shipped' }], details: undefined }
      }
    })
    const first = respondingModel(
      (_request, call) =>
        [
          assistantReply(
            [{ type: 'toolCall', id: 'call_lookup', name: 'lookup_order', arguments: {} }],
            'toolUse'
          ) satisfies AssistantMessage,
          recall('recall_1', { query: 'ORDER-7731' }),
          reply('Shipped.')
        ][call - 1]
    )
    const { session, dispose } = await createRecallSession({
      stream: first.model,
      tools: [lookup],
      onEvent
    })
    await session.prompt('Where is my order?')

    const [found] = recallOutputs(committed)
    const index = Number(/#(\d+) \[tool_result:lookup_order\] ORDER-7731 shipped/.exec(found)![1])

    const second = respondingModel((_request, call) => [recall('recall_2', { expand: [index] }), reply('ok')][call - 1])
    await dispose()
    const rebuiltHost = hostStore()
    const rebuilt = await createRecallSession({
      stream: second.model,
      tools: [lookup],
      entries: [...committed],
      onEvent: rebuiltHost.onEvent
    })
    await rebuilt.session.prompt('Show that order entry')

    expect(recallOutputs(rebuiltHost.entries)).toEqual([`#${index} [tool_result:lookup_order] ORDER-7731 shipped`])
  })
})
