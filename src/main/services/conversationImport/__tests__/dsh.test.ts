import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { zstdCompressSync } from 'node:zlib'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { dshAdapter } from '../dsh'
import type { SessionRef } from '../types'

describe('DSH session archives', () => {
  const signal = new AbortController().signal
  let root: string
  let dir: string
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'cherry-dsh-'))
    dir = path.join(root, 'sessions', 'project', 'child')
    await mkdir(dir, { recursive: true })
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const event = (type: string, data: object, time = 100) => ({ type, data, time })
  const user = event('user/message', { id: 'u', content: [{ type: 'text', text: 'Inherited question' }] })
  function archive(version: number, ...events: unknown[]) {
    const header = { type: 'session', version, id: 'child', parentSession: 'parent', cwd: root, createdAt: 50 }
    return Buffer.concat([header, ...events].map((row) => zstdCompressSync(JSON.stringify(row) + '\n')))
  }
  async function discover() {
    const refs: SessionRef[] = []
    for await (const ref of dshAdapter.discover(root, signal)) refs.push(ref)
    return refs
  }
  async function save(version: number, ...rows: unknown[]) {
    const file = path.join(dir, version === 0 ? 'session.jsonl.zstd' : `session.v${version}.jsonl.zstd`)
    await writeFile(file, archive(version, ...rows))
    return { path: file }
  }

  it('reads the complete parentless child once across legacy and nested seed boundaries', async () => {
    const texts = ['Grandparent prompt', 'Parent prompt', 'Child prompt']
    for (const version of [0, 3, 4]) {
      const header = {
        type: 'session',
        version,
        id: 'child',
        cwd: root,
        createdAt: 50,
        ...(version === 0 && { seedLength: 3 })
      }
      const rows: unknown[] = [header]
      for (const [index, text] of texts.entries()) {
        const seq = index * 2
        const data =
          version === 0 ? { content: text } : { id: 'legacy-message:child:' + seq, content: [{ type: 'text', text }] }
        rows.push({ ...event('user/message', data, 100 + seq), seq })
        if (index < 2)
          rows.push({ ...event('session/end-seed', version === 0 ? {} : { inherited: true }, 100 + seq), seq: seq + 1 })
      }
      const file = path.join(dir, version === 0 ? 'session.jsonl.zstd' : `session.v${version}.jsonl.zstd`)
      await writeFile(file, zstdCompressSync(rows.map((row) => JSON.stringify(row)).join('\n') + '\n'))
      const session = await dshAdapter.read({ path: file }, signal)
      expect(session.messages.map((m) => m.data.parts)).toEqual(texts.map((text) => [{ type: 'text', text }]))
    }
    const refs = await discover()
    expect(refs).toHaveLength(1)
    const merged = await dshAdapter.read(refs[0], signal)
    expect(merged.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(merged.messages.map((m) => m.data.parts)).toEqual(texts.map((text) => [{ type: 'text', text }]))
  })

  it('keeps an automatic goal round as context beside a direct prompt with the same text', async () => {
    const content = [{ type: 'text', text: 'Continue the goal' }]
    const direct = event('user/message', { id: 'direct', content, source: { kind: 'user' } })
    const automatic = event('user/message', {
      id: 'round',
      content,
      source: { kind: 'goal', goalId: 'g', revision: 1, round: 1 }
    })
    const session = await dshAdapter.read(await save(4, direct, automatic), signal)
    expect(session.messages.map((m) => [m.role, m.data.parts])).toEqual([
      ['user', content],
      ['system', content]
    ])
  })

  it('matches flat v0 messages with migrated IDs and preserves failed tool output', async () => {
    const step = { turn: 1, step: 1 }
    const prompt = { content: 'Read the note', source: { kind: 'user' } }
    const model = { provider: 'sample', model: 'test' }
    const call = { type: 'tool-call', id: 'c', name: 'read', arguments: '{}' }
    const content = [{ type: 'text', text: 'Checking the note' }, call]
    const output = [{ type: 'text', text: 'Note missing' }]
    const invoke = event('tool/call', { ...step, callId: 'c', name: 'read', arguments: '{}' })
    const legacy = await save(
      0,
      { ...event('user/message', prompt), seq: 1 },
      { ...event('assistant/message', { ...step, content, provenance: model }), seq: 2 },
      invoke,
      { ...event('tool/result', { ...step, callId: 'c', content: output, isError: true }), seq: 4 }
    )
    const before = await dshAdapter.read(legacy, signal)
    expect(before.messages.map((m) => m.provenance.originalMessageId)).toEqual([
      'legacy-message:child:1',
      'legacy-message:child:2',
      'call:c',
      'result:c'
    ])
    expect(before.messages[1].data.parts).toEqual([{ type: 'text', text: 'Checking the note' }])
    expect(before.messages[3]).toMatchObject({
      status: 'error',
      data: { parts: [{ text: expect.stringContaining('Note missing') }] }
    })
    const answer = { id: 'legacy-message:child:2', role: 'assistant', content, source: { kind: 'model', ...model } }
    const result = { type: 'tool-result', toolCallId: 'c', content: output, isError: true }
    await save(
      4,
      event('user/message', { ...prompt, id: 'legacy-message:child:1', role: 'user' }),
      event('assistant/message', { ...step, message: answer }),
      invoke,
      event('tool/result', {
        ...step,
        message: {
          id: 'legacy-message:child:4',
          role: 'user',
          source: { kind: 'tool', callId: 'c' },
          content: [result]
        }
      })
    )
    const refs = await discover()
    expect(refs).toHaveLength(1)
    const migrated = await dshAdapter.read(refs[0], signal)
    expect(migrated).toMatchObject({ sourceVersion: '4', diagnostics: [], messages: before.messages })
  })

  it('recovers a terminal attempt once and prefers the delivered message after a retry', async () => {
    const step = { turn: 1, step: 1 }
    const thought = { type: 'reasoning', text: 'Thought' }
    const stream = [
      { type: 'chunk', time: 100, chunk: { type: 'block-end', index: 0, block: thought } },
      { type: 'text-chunks', time0: 100, index: 1, dt: [1], texts: ['Part', 'ial'] }
    ]
    const mirror = event('text-chunks', { ...step, index: 1, texts: ['Partial'] })
    const rows = [user, mirror, event('assistant/attempt', { ...step, stream })]
    const partial = await dshAdapter.read(await save(4, ...rows), signal)
    const parts = [thought, { type: 'text', text: 'Partial' }]
    expect(partial.messages.slice(1)).toMatchObject([{ status: 'paused', data: { parts } }])

    const message = { id: 'final', content: [{ type: 'text', text: 'Delivered answer' }] }
    for (const interrupted of [false, true]) {
      const final = event('assistant/message', { ...step, message, interrupted })
      const recovered = await dshAdapter.read(await save(4, ...rows, event('llm/retry', step), final), signal)
      expect(recovered.messages.slice(1)).toMatchObject([
        { status: interrupted ? 'paused' : 'success', data: { parts: message.content } }
      ])
    }
    const nextStep = event('assistant/message', { ...step, step: 2, message })
    const continued = await dshAdapter.read(await save(4, ...rows, nextStep), signal)
    expect(continued.messages.slice(1)).toMatchObject([
      { status: 'paused', data: { parts } },
      { status: 'success', data: { parts: message.content } }
    ])
  })

  it.each([0, 3])(
    'matches recovered v%d retries to a migrated copy despite shifted lines and settlement times',
    async (version) => {
      const step = { turn: 2, step: 1 }
      const start = event('turn/start', { turn: 2 })
      const retry = event('llm/retry', step)
      const run = { index: 0, texts: ['Part', 'ial'], dt: [9] }
      const packed = { type: 'text-chunks', time0: 105, seq0: 5, data: { ...step, ...run } }
      const chunk = { type: 'tool-call-delta', index: 1, id: '', name: 'read', argumentsDelta: '{}' }
      const tool = event('assistant/chunk', { ...step, chunk }, 114)
      const stream = [
        { type: 'text-chunks', time0: 105, ...run },
        { type: 'chunk', time: 114, chunk }
      ]
      const attempt = event('assistant/attempt', { ...step, stream }, 114)
      const prefix = [
        user,
        event('turn/start', { turn: 1 }),
        event('agent/inbox/spliced', { target: 'next-turn', inserted: [1] })
      ]
      const original = version === 0 ? [packed, tool, retry, { ...packed, seq0: 9 }, tool] : [attempt, retry, attempt]
      await save(version, ...prefix, start, ...original)
      await save(
        4,
        ...prefix,
        event('turn/end', { turn: 1, reason: { kind: 'interrupted' } }),
        start,
        attempt,
        retry,
        attempt
      )
      const [ref] = await discover()
      const history = await dshAdapter.read(ref, signal)
      expect(history.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
      const replies = history.messages.filter((m) => m.role === 'assistant')
      const recovered = { timestamp: 105, status: 'paused', data: { parts: [{ type: 'text', text: 'Partial' }] } }
      expect(replies).toMatchObject([recovered, recovered])
      expect(replies[0].provenance.originalMessageId).not.toBe(replies[1].provenance.originalMessageId)
      expect(history.messages.filter((m) => m.role === 'system')).toHaveLength(2)
    }
  )

  it('skips generated compaction checkpoints and keeps matching user-authored text', async () => {
    const answer = event('assistant/message', { message: { id: 'answer', content: 'Original answer' } })
    const content = [{ type: 'text', text: 'Earlier summary' }]
    const source = { kind: 'compact-checkpoint', compactionId: 'compact' }
    const summary = event('user/message', { id: 'checkpoint', content, source })
    const typed = event('user/message', { id: 'typed', content, source: { kind: 'user' } })
    const session = await dshAdapter.read(await save(4, user, answer, summary, typed), signal)
    expect(session.messages.map((m) => m.provenance.originalMessageId)).toEqual(['u', 'answer', 'typed'])
    expect(session.skippedRecords).toBe(1)
  })

  it('selects the complete migrated history, deduplicates seeded messages and stream mirrors, and recovers the unfinished answer', async () => {
    await writeFile(path.join(dir, 'session.jsonl.zstd'), archive(0, user))
    const file = path.join(dir, 'session.v4.jsonl.zstd')
    const step = { turn: 1, step: 1 }
    const tool = { type: 'tool-call', id: 'c', name: 'read', arguments: '{"path":"notes"}' }
    await writeFile(
      file,
      archive(
        4,
        user,
        event('session/end-seed', {}),
        user,
        event('request/header', { text: 'operational' }),
        event('reasoning-chunks', { ...step, index: 0, texts: ['duplicate reasoning'] }),
        event('assistant/message', {
          ...step,
          message: { id: 'a', content: [{ type: 'reasoning', text: 'Final reasoning' }, tool] }
        }),
        event('tool/call', { ...step, callId: 'c', name: 'read', arguments: tool.arguments }),
        event('tool/result', {
          ...step,
          message: { id: 'r', toolCallId: 'c', content: [{ type: 'text', text: 'Tool output' }] }
        }),
        event('unknown/event', { text: 'Readable archive note' }),
        event('text-chunks', { turn: 1, step: 2, index: 0, texts: ['Partial', ' answer'] }, 80)
      )
    )
    const [ref] = await discover()
    expect(ref.sourcePaths).toHaveLength(2)
    const session = await dshAdapter.read(ref, signal)
    expect(session.diagnostics.every((d) => d.severity === 'warning')).toBe(true)
    expect(session.messages.map((m) => m.data.parts?.[0])).toEqual([
      { type: 'text', text: 'Inherited question' },
      { type: 'reasoning', text: 'Final reasoning' },
      { type: 'text', text: expect.stringContaining('[Historical tool call: read]') },
      { type: 'text', text: expect.stringContaining('[Historical tool result: read]\n\nTool output') },
      { type: 'text', text: expect.stringContaining('Readable archive note') },
      { type: 'text', text: 'Partial answer' }
    ])
    expect(session.messages.at(-1)).toMatchObject({ timestamp: 80, status: 'paused' })
    await writeFile(
      path.join(dir, 'session.jsonl.zstd'),
      archive(0, event('user/message', { id: 'u', content: 'Other question' }))
    )
    expect((await dshAdapter.read(ref, signal)).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'identity_conflict', severity: 'error' })
    )
  })
  it('uses a complete copy that contains both older ordered subsets', async () => {
    const second = event('user/message', { id: 'two', content: 'Second' })
    const last = event('user/message', { id: 'last', content: 'Last' })
    await writeFile(path.join(dir, 'session.jsonl.zstd'), archive(0, user, last))
    await writeFile(path.join(dir, 'session.v3.jsonl.zstd'), archive(3, second, last))
    await writeFile(path.join(dir, 'session.v4.jsonl.zstd'), archive(4, user, second, last))
    const [ref] = await discover()
    const session = await dshAdapter.read(ref, signal)
    expect(session.diagnostics).toEqual([])
    expect(session.messages.map((m) => m.provenance.originalMessageId)).toEqual(['u', 'two', 'last'])
  })
  it('filters only complete settings histories and retries a repaired final frame', async () => {
    const file = path.join(dir, 'session.v4.jsonl.zstd')
    await writeFile(file, archive(4, event('permission/preset', {})))
    expect((await discover())[0].filteredReason).toBe('dsh_settings_only')
    const bytes = archive(4, user, event('user/message', { id: 'last', content: 'Last frame' }))
    await writeFile(file, bytes.subarray(0, -1))
    const [ref] = await discover()
    expect(ref.filteredReason).toBeUndefined()
    expect((await dshAdapter.read(ref, signal)).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'incomplete_source', severity: 'error' })
    )
    await writeFile(file, bytes)
    const repaired = await dshAdapter.read(ref, signal)
    expect(repaired.diagnostics).toEqual([])
    expect(repaired.messages.at(-1)?.data.parts).toEqual([{ type: 'text', text: 'Last frame' }])
  })
})
