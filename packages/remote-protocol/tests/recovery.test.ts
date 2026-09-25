import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  applyAgentEvents,
  encodeAgentCheckpointPage,
  installAgentCheckpoint,
  type AgentCheckpointPage,
  type AgentEventBatch,
  type AgentProjection
} from '../src/agent'

const integrity = { sha256: (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex') }
const state = (): AgentProjection => ({
  cursor: { sessionId: 's', streamEpoch: 'epoch', seq: '0' },
  session: {
    sessionId: 's',
    agentId: 'a',
    workspaceId: 'w',
    title: 'Example',
    updatedAt: '2026-09-21T00:00:00Z',
    historyRevision: '0',
    idleRevision: '0'
  },
  messages: {},
  parts: {},
  executions: {},
  interactions: {},
  tombstones: []
})
const batch = (events: AgentEventBatch['events']): AgentEventBatch => ({
  subscriptionId: 'sub',
  sessionId: 's',
  streamEpoch: 'epoch',
  events
})
const initial: AgentEventBatch['events'] = [
  {
    seq: '1',
    kind: 'message.created',
    payload: { messageId: 'm', revision: '0', role: 'assistant', status: 'pending', partIds: [] }
  },
  {
    seq: '2',
    kind: 'part.created',
    payload: {
      messageId: 'm',
      afterPartId: null,
      messageBaseRevision: '0',
      messageRevision: '1',
      part: { partId: 'p', revision: '0', kind: 'text', content: { text: '你' }, state: 'streaming' }
    }
  }
]

describe('atomic event recovery', () => {
  it('treats object prototype names as ordinary resource identifiers', () => {
    const result = applyAgentEvents(
      state(),
      batch([
        {
          seq: '1',
          kind: 'message.created',
          payload: { messageId: '__proto__', revision: '0', role: 'assistant', status: 'pending', partIds: [] }
        }
      ]),
      {},
      integrity
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(Object.keys(result.projection.messages)).toEqual(['__proto__'])
    expect(result.projection.messages.__proto__.messageId).toBe('__proto__')
  })

  it('requires streaming references before advancing the cursor and retains their bytes', () => {
    const bytes = new TextEncoder().encode('你')
    const events: AgentEventBatch['events'] = [
      initial[0],
      {
        seq: '2',
        kind: 'part.created',
        payload: {
          messageId: 'm',
          afterPartId: null,
          messageBaseRevision: '0',
          messageRevision: '1',
          part: {
            partId: 'p',
            revision: '0',
            kind: 'text',
            state: 'streaming',
            content: {
              ref: {
                contentId: 'c',
                revision: '0',
                byteLength: '3',
                sha256: integrity.sha256(bytes),
                mediaType: 'text/plain'
              }
            }
          }
        }
      }
    ]
    expect(applyAgentEvents(state(), batch(events), {}, integrity)).toEqual({ ok: false, reason: 'content' })
    const result = applyAgentEvents(state(), batch(events), { 'c:0': bytes }, integrity)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.projection.parts.p).toMatchObject({ content: { text: '你' } })
    expect(result.cursor.seq).toBe('2')
  })

  it('applies Unicode appends once using byte offsets, including a duplicate replay prefix', () => {
    const input = state()
    const first = applyAgentEvents(input, batch(initial), {}, integrity)
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.reason)
    const next = applyAgentEvents(
      first.projection,
      batch([
        ...initial,
        {
          seq: '3',
          kind: 'part.append',
          payload: { messageId: 'm', partId: 'p', baseRevision: '0', revision: '1', offsetUtf8: '3', text: '好🌍' }
        }
      ]),
      {},
      integrity
    )
    expect(next.ok).toBe(true)
    if (!next.ok) throw new Error(next.reason)
    expect(next.projection.parts.p).toMatchObject({ content: { text: '你好🌍' }, revision: '1' })
    expect(next.cursor.seq).toBe('3')
    expect(input.messages).toEqual({})
    expect(first.projection.parts.p).toMatchObject({ content: { text: '你' } })
  })

  it('does not partially apply a batch with a gap or bad append offset', () => {
    const input = state()
    const result = applyAgentEvents(
      input,
      batch([
        ...initial,
        {
          seq: '3',
          kind: 'part.append',
          payload: { messageId: 'm', partId: 'p', baseRevision: '0', revision: '1', offsetUtf8: '1', text: 'x' }
        }
      ]),
      {},
      integrity
    )
    expect(result).toEqual({ ok: false, reason: 'content' })
    expect(input).toEqual(state())
    expect(applyAgentEvents(input, batch([{ ...initial[0], seq: '2' }]), {}, integrity)).toEqual({
      ok: false,
      reason: 'gap'
    })
  })

  it('rejects false completion digests and events from another session or epoch', () => {
    const first = applyAgentEvents(state(), batch(initial), {}, integrity)
    if (!first.ok) throw new Error(first.reason)
    expect(
      applyAgentEvents(
        first.projection,
        batch([
          {
            seq: '3',
            kind: 'part.completed',
            payload: {
              messageId: 'm',
              partId: 'p',
              baseRevision: '0',
              revision: '1',
              byteLength: '3',
              sha256: '0'.repeat(64)
            }
          }
        ]),
        {},
        integrity
      )
    ).toEqual({ ok: false, reason: 'content' })
    expect(applyAgentEvents(first.projection, { ...batch(initial), streamEpoch: 'other' }, {}, integrity)).toEqual({
      ok: false,
      reason: 'epoch'
    })
  })
})

describe('checkpoint installation', () => {
  function checkpoint() {
    const page: AgentCheckpointPage = {
      checkpointId: 'cp',
      pageIndex: 0,
      items: [{ kind: 'session', value: state().session }],
      nextCursor: null,
      pageDigest: '0'.repeat(64)
    }
    const bytes = encodeAgentCheckpointPage(page)
    page.pageDigest = integrity.sha256(bytes)
    const descriptor = {
      checkpointId: 'cp',
      cursor: state().cursor,
      historyRevision: '0',
      pageCount: 1,
      byteLength: String(bytes.length),
      sha256: page.pageDigest,
      expiresAt: '2026-09-21T00:05:00Z'
    }
    return { page, descriptor }
  }

  it('installs a complete baseline and rejects missing or changed pages', () => {
    const { page, descriptor } = checkpoint()
    const result = installAgentCheckpoint(descriptor, [page], {}, integrity)
    expect(result).toEqual({ ok: true, projection: state(), cursor: state().cursor })
    expect(installAgentCheckpoint(descriptor, [], {}, integrity)).toEqual({ ok: false, reason: 'incomplete' })
    expect(installAgentCheckpoint(descriptor, [{ ...page, items: [] }], {}, integrity)).toEqual({
      ok: false,
      reason: 'digest'
    })
  })
})
