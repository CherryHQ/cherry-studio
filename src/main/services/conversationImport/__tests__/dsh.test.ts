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
