import { Type } from '@earendil-works/pi-ai'
import { createToolSearchExtension, defineTool, type ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { type TranscriptEntry, TranscriptError, type TranscriptErrorCode } from '../src'
import {
  createTestSession,
  finish,
  hostStore,
  plain,
  scriptedModel,
  streamTextPort,
  tempDir,
  textParts
} from './support'

const todoTool = defineTool({
  name: 'todo_write',
  label: 'Todo',
  description: 'Replace the todo list',
  parameters: Type.Object({ items: Type.Array(Type.String()) }),
  async execute(_id, params) {
    return { content: [{ type: 'text', text: `${params.items.length} todos` }], details: { items: params.items } }
  }
})

/** Like L3's goal extension: state snapshots plus a context-bearing round prompt. */
const goalExtension: ExtensionFactory = (pi) => {
  let rounds = 0
  pi.on('turn_end', () => {
    if (rounds++ > 0) return
    pi.appendEntry('cherry.goal', { objective: 'plan the trip', status: 'active' })
    pi.sendMessage({ customType: 'cherry.goal-round', content: 'GOAL-ROUND: keep going', display: false })
  })
}

/** What an extension finds on the branch when it starts. */
function sessionStartObserver(seen: unknown[]): ExtensionFactory {
  return (pi) => {
    pi.on('session_start', (_event, ctx) => {
      for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type === 'custom') seen.push({ state: entry.customType, data: entry.data })
        if (entry.type === 'custom_message') seen.push({ customMessage: entry.customType, content: entry.content })
        if (entry.type === 'message' && entry.message.role === 'toolResult')
          seen.push({ details: entry.message.details })
      }
    })
  }
}

describe('session transcript', () => {
  it('rebuilds a session that sends the same request as the live one, with state visible at session start', async () => {
    const live = scriptedModel([
      [
        { type: 'reasoning-start', id: 'r' },
        { type: 'reasoning-delta', id: 'r', delta: 'list the steps' },
        { type: 'reasoning-end', id: 'r', providerMetadata: { anthropic: { signature: 'sig-plan' } } },
        {
          type: 'tool-call',
          toolCallId: 'call_todo',
          toolName: 'todo_write',
          input: JSON.stringify({ items: ['flights', 'hotel'] }),
          providerMetadata: { google: { thoughtSignature: 'ts-todo' } }
        },
        finish('tool-calls', 40, 12)
      ],
      [...textParts('a', 'Planned.'), finish('stop', 80, 4)],
      [...textParts('b', 'Hotels next.'), finish('stop', 95, 5)],
      [...textParts('c', 'Done.'), finish('stop', 110, 2)]
    ])
    const host = hostStore()
    const cwd = tempDir('cwd')
    const liveRuntime = await createTestSession({
      cwd,
      port: streamTextPort(live.model).port,
      tools: [todoTool],
      extensionFactories: [goalExtension],
      onEvent: host.onEvent
    })
    await liveRuntime.session.prompt('Plan the trip')
    await liveRuntime.session.prompt('What is next?')

    const seen: unknown[] = []
    const rebuiltModel = scriptedModel([[...textParts('c', 'Done.'), finish('stop', 110, 2)]])
    const rebuilt = await createTestSession({
      cwd,
      port: streamTextPort(rebuiltModel.model).port,
      tools: [todoTool],
      extensionFactories: [goalExtension, sessionStartObserver(seen)],
      transcript: plain(host.entries)
    })
    expect(rebuilt.session.getContextUsage()).toEqual(liveRuntime.session.getContextUsage())

    await liveRuntime.session.prompt('Anything else?')
    await rebuilt.session.prompt('Anything else?')
    const [liveRequest, rebuiltRequest] = [live.calls[3], rebuiltModel.calls[0]]
    expect(plain(rebuiltRequest.prompt)).toEqual(plain(liveRequest.prompt))
    expect(plain(rebuiltRequest.tools)).toEqual(plain(liveRequest.tools))
    expect(rebuiltRequest.maxOutputTokens).toBe(liveRequest.maxOutputTokens)
    expect(JSON.stringify(liveRequest.prompt)).toContain('GOAL-ROUND: keep going')

    expect(seen).toEqual([
      { details: { items: ['flights', 'hotel'] } },
      { state: 'cherry.goal', data: { objective: 'plan the trip', status: 'active' } },
      { customMessage: 'cherry.goal-round', content: 'GOAL-ROUND: keep going' }
    ])
  })

  it('emits each entry once, in Pi order, and reports the head when a turn settles', async () => {
    const { model } = scriptedModel([
      [
        { type: 'tool-call', toolCallId: 'call_1', toolName: 'todo_write', input: '{"items":["a"]}' },
        finish('tool-calls')
      ],
      [...textParts('a', 'ok'), finish('stop')],
      [...textParts('b', 'ok again'), finish('stop')]
    ])
    const host = hostStore()
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [todoTool],
      extensionFactories: [goalExtension],
      onEvent: host.onEvent
    })
    await session.prompt('one')
    const headAfterFirst = host.entries.at(-1)?.id
    await session.prompt('two')

    const ids = host.entries.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    const piOrder = session.sessionManager.getBranch().flatMap((entry) => (ids.includes(entry.id) ? [entry.id] : []))
    expect(ids).toEqual(piOrder)
    const summary = host.entries.map((entry) =>
      entry.kind === 'message' ? (entry.custom ? `custom:${entry.custom.type}` : entry.message.role) : entry.kind
    )
    expect(summary).toEqual([
      'user',
      'assistant',
      'tool',
      'state',
      'custom:cherry.goal-round',
      'assistant',
      'user',
      'assistant'
    ])
    expect(host.events.filter((event) => event.type === 'turn-complete')).toEqual([
      { type: 'turn-complete', headEntryId: headAfterFirst, aborted: false },
      { type: 'turn-complete', headEntryId: ids.at(-1), aborted: false }
    ])
  })

  it('keeps tools that tool_search activated after a rebuild, next to tools the host added since', async () => {
    const weather = defineTool({
      name: 'get_weather',
      label: 'Weather',
      description: 'Get the weather forecast for a city',
      parameters: Type.Object({ city: Type.String() }),
      exposure: 'deferred',
      async execute() {
        return { content: [{ type: 'text', text: 'Sunny' }], details: undefined }
      }
    })
    const hostTool = defineTool({
      name: 'host_new',
      label: 'New',
      description: 'A tool the host enabled later',
      parameters: Type.Object({}),
      async execute() {
        return { content: [{ type: 'text', text: 'done' }], details: undefined }
      }
    })
    const first = scriptedModel([
      [
        { type: 'tool-call', toolCallId: 'search_1', toolName: 'tool_search', input: '{"query":"weather forecast"}' },
        finish('tool-calls')
      ],
      [...textParts('a', 'Loaded.'), finish('stop')]
    ])
    const host = hostStore()
    const earlier = await createTestSession({
      port: streamTextPort(first.model).port,
      tools: [weather],
      builtinTools: ['tool_search'],
      extensionFactories: [createToolSearchExtension()],
      onEvent: host.onEvent
    })
    await earlier.session.prompt('Find a weather tool')
    expect(first.calls[1].tools?.map((t) => t.name)).toContain('get_weather')

    const second = scriptedModel([[...textParts('b', 'ok'), finish('stop')]])
    const { session } = await createTestSession({
      port: streamTextPort(second.model).port,
      tools: [weather, hostTool],
      builtinTools: ['tool_search'],
      extensionFactories: [createToolSearchExtension()],
      transcript: host.entries
    })
    await session.prompt('Weather in Oslo?')

    expect(second.calls[0].tools?.map((t) => t.name).sort()).toEqual(['get_weather', 'host_new', 'tool_search'])
  })

  const user = (id: string): TranscriptEntry => ({
    kind: 'message',
    id,
    timestamp: 1,
    message: { role: 'user', content: 'hi' }
  })
  it.each<{ code: TranscriptErrorCode; transcript: unknown[] }>([
    { code: 'duplicate_id', transcript: [user('a'), user('a')] },
    {
      code: 'orphan_tool_result',
      transcript: [
        user('a'),
        {
          kind: 'message',
          id: 'b',
          timestamp: 1,
          message: {
            role: 'tool',
            content: [
              { type: 'tool-result', toolCallId: 'nowhere', toolName: 'x', output: { type: 'text', value: '' } }
            ]
          }
        }
      ]
    },
    {
      code: 'compaction_boundary_missing',
      transcript: [
        user('a'),
        { kind: 'compaction', id: 'c', timestamp: 1, summary: 's', firstKeptEntryId: 'z', tokensBefore: 1 }
      ]
    },
    {
      code: 'edit_target_missing',
      transcript: [user('a'), { kind: 'context-edit', id: 'e', timestamp: 1, targetId: 'z', replacement: null }]
    },
    {
      code: 'unsupported_content',
      transcript: [
        {
          kind: 'message',
          id: 'a',
          timestamp: 1,
          message: { role: 'user', content: [{ type: 'image', image: 'https://example.com/a.png' }] }
        }
      ]
    },
    { code: 'invalid_entry', transcript: [user('a'), { kind: 'bash', id: 'b', timestamp: 1 }] }
  ])('refuses a transcript with $code', async ({ code, transcript }) => {
    const { model, calls } = scriptedModel([[...textParts('t', 'ok'), finish('stop')]])
    const creating = createTestSession({
      port: streamTextPort(model).port,
      transcript: transcript as TranscriptEntry[]
    })

    await expect(creating).rejects.toBeInstanceOf(TranscriptError)
    await expect(creating).rejects.toMatchObject({ code })
    expect(calls).toHaveLength(0)
  })

  const message = (content: unknown, role = 'user') => ({
    kind: 'message',
    id: 'b',
    timestamp: 1,
    message: { role, content }
  })
  it.each<{ label: string; entry: unknown }>([
    { label: 'null user content', entry: message(null) },
    { label: 'non-string text', entry: message([{ type: 'text', text: 42 }]) },
    { label: 'null assistant content', entry: message(null, 'assistant') },
    {
      label: 'non-string tool output',
      entry: message(
        [{ type: 'tool-result', toolCallId: 'c', toolName: 'x', output: { type: 'text', value: 42 } }],
        'tool'
      )
    },
    {
      label: 'non-string compaction boundary',
      entry: { kind: 'compaction', id: 'b', timestamp: 1, summary: 's', firstKeptEntryId: null, tokensBefore: 1 }
    },
    {
      label: 'non-string edit target',
      entry: { kind: 'context-edit', id: 'b', timestamp: 1, targetId: 42, replacement: null }
    }
  ])('refuses $label as an invalid entry before creating anything', async ({ entry }) => {
    const { model, calls } = scriptedModel([[...textParts('t', 'ok'), finish('stop')]])
    const creating = createTestSession({
      port: streamTextPort(model).port,
      transcript: [user('a'), entry] as TranscriptEntry[]
    })

    await expect(creating).rejects.toMatchObject({ name: 'TranscriptError', code: 'invalid_entry', entryId: 'b' })
    expect(calls).toHaveLength(0)
  })
})
