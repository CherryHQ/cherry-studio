import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { SessionManager } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import * as fork from '@main/ai/runtime/fork'

import { probePiFork } from '../piForkAvailability'

vi.mock('@main/ai/runtime/fork', async (importOriginal) => {
  const original = await importOriginal<typeof fork>()
  return { ...original, readForkPrefix: vi.fn(original.readForkPrefix) }
})

describe('Pi fork availability', () => {
  let directory: string
  let sessions: string
  let file: string
  let first: string
  let later: string
  let side: string
  const token = 'session-123'
  const checkpoint = (leafId: string, runtimeSessionId = token) => ({
    runtime: 'pi' as const,
    runtimeSessionId,
    leafId
  })
  const candidate = (messageId: string, leafId = first, ancestors = [checkpoint(leafId)]) => ({
    messageId,
    checkpoint: checkpoint(leafId),
    checkpoints: ancestors,
    cwd: directory
  })
  const probe = async (leafId = first, ancestors = [checkpoint(leafId)]) =>
    (await probePiFork([candidate('one', leafId, ancestors)])).get('one')
  const save = (entries: unknown[]) =>
    writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n')

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'pi-probe-'))
    sessions = path.join(directory, 'sessions')
    mkdirSync(sessions)
    mkdirSync(path.join(directory, 'artifacts'))
    vi.mocked(application.getPath).mockReturnValue(sessions)
    const manager = SessionManager.inMemory(directory, { id: token })
    first = manager.appendCustomEntry('first')
    later = manager.appendCustomEntry('later')
    manager.branch(first)
    side = manager.appendCustomEntry('side')
    file = path.join(sessions, `2026_${token}.jsonl`)
    save([manager.getHeader(), ...manager.getEntries()])
    vi.mocked(fork.readForkPrefix).mockClear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(directory, { recursive: true, force: true })
  })

  it('accepts a valid custom leaf and preserves files and directories', async () => {
    const before = readFileSync(file)
    const sessionNames = readdirSync(sessions)
    const artifacts = readdirSync(path.join(directory, 'artifacts'))
    expect(await probe(later, [checkpoint(first), checkpoint(later)])).toEqual({ enabled: true })
    expect(readFileSync(file)).toEqual(before)
    expect(readdirSync(sessions)).toEqual(sessionNames)
    expect(readdirSync(path.join(directory, 'artifacts'))).toEqual(artifacts)
  })

  it('selects the newest matching file', async () => {
    writeFileSync(path.join(sessions, `2027_${token}.jsonl`), readFileSync(file))
    writeFileSync(file, 'bad\n')
    expect(await probe()).toEqual({ enabled: true })
  })

  it('rejects malformed complete lines and ignores an incomplete trailing line including appends', async () => {
    appendFileSync(file, '{broken')
    expect(await probe()).toEqual({ enabled: true })
    appendFileSync(file, '\n')
    expect(await probe()).toEqual({ enabled: false, reason: 'history_corrupt' })
  })

  it('allows an append between reads but detects a changed prefix', async () => {
    const original = await vi.importActual<typeof fork>('@main/ai/runtime/fork')
    vi.mocked(fork.readForkPrefix).mockImplementationOnce(async (...args) => {
      const bytes = await original.readForkPrefix(...args)
      appendFileSync(file, '{"type":"custom"}\n')
      return bytes
    })
    expect(await probe()).toEqual({ enabled: true })
    vi.mocked(fork.readForkPrefix).mockImplementationOnce(async (...args) => {
      const bytes = await original.readForkPrefix(...args)
      const modified = Buffer.from(bytes)
      modified[0] = 32
      writeFileSync(file, modified)
      return bytes
    })
    expect(await probe()).toEqual({ enabled: false, reason: 'history_changed' })
  })

  it('reports ordinary read failures as unknown', async () => {
    vi.mocked(fork.readForkPrefix).mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
    expect(await probe()).toEqual({ enabled: null, reason: 'operation_failed' })
  })

  it('distinguishes missing header, mismatched session and missing leaf', async () => {
    const original = readFileSync(file, 'utf8').split('\n')
    writeFileSync(file, original.slice(1).join('\n'))
    expect(await probe()).toEqual({ enabled: null, reason: 'operation_failed' })
    const header = JSON.parse(original[0])
    header.id = 'other'
    writeFileSync(file, [JSON.stringify(header), ...original.slice(1)].join('\n'))
    expect(await probe()).toEqual({ enabled: false, reason: 'history_changed' })
    writeFileSync(file, original.join('\n'))
    expect(await probe('absent')).toEqual({ enabled: false, reason: 'history_changed' })
    expect((await probePiFork([{ ...candidate('bad'), checkpoint: checkpoint(first, 'bad_id') }])).get('bad')).toEqual({
      enabled: false,
      reason: 'history_corrupt'
    })
    expect(
      (await probePiFork([{ ...candidate('missing'), checkpoint: checkpoint(first, 'missing') }])).get('missing')
    ).toEqual({ enabled: false, reason: 'history_missing' })
  })

  it('rejects future and side branch ancestors and isolates candidate managers', async () => {
    expect(await probe(first, [checkpoint(later)])).toEqual({ enabled: false, reason: 'history_corrupt' })
    expect(await probe(later, [checkpoint(side)])).toEqual({ enabled: false, reason: 'history_corrupt' })
    const result = await probePiFork([
      candidate('early'),
      candidate('late', later, [checkpoint(first), checkpoint(later)]),
      candidate('side', side, [checkpoint(first), checkpoint(side)])
    ])
    expect([...result.values()]).toEqual([{ enabled: true }, { enabled: true }, { enabled: true }])
  })

  it.each([50, 200])('reads the shared committed prefix twice for %i candidates', async (count) => {
    const items = Array.from({ length: count }, (_, index) =>
      candidate(String(index), index % 2 ? later : side, [checkpoint(first)])
    )
    const result = await probePiFork(items)
    expect(result.size).toBe(count)
    for (const item of items) expect(result.get(item.messageId)).toEqual({ enabled: true })
    expect(fork.readForkPrefix).toHaveBeenCalledTimes(2)
    expect(vi.mocked(fork.readForkPrefix).mock.calls.map((args) => args[1])).toEqual([
      undefined,
      readFileSync(file).length
    ])
  })
})
