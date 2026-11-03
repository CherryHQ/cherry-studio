import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import * as nativeHistory from '../../fork/nativeHistory'
import { probeClaudeFork } from '../claudeFork'

describe('Claude fork availability', () => {
  let directory = ''
  afterEach(async () => {
    vi.restoreAllMocks()
    if (directory) await rm(directory, { recursive: true, force: true })
  })
  it.each([50, 200])('reads a shared file twice for %i candidates and preserves it', async (count) => {
    directory = await mkdtemp(path.join(process.env.TMPDIR!, 'claude-probe-'))
    const project = path.join(directory, 'projects', 'project')
    await mkdir(project, { recursive: true })
    const sessionId = randomUUID()
    const ids = Array.from({ length: count }, () => randomUUID())
    const file = path.join(project, `${sessionId}.jsonl`)
    const contents =
      ids.map((uuid) => JSON.stringify({ uuid, type: 'assistant', message: '中文' })).join('\r\n') + '\r\n'
    await writeFile(file, contents)
    const checkpoint = (messageUuid: string) => ({
      runtime: 'claude-code' as const,
      runtimeSessionId: sessionId,
      messageUuid,
      configDir: directory
    })
    const candidates = ids.map((id) => ({
      messageId: id,
      checkpoint: checkpoint(id),
      checkpoints: [checkpoint(id)],
      cwd: directory
    }))
    const reads = vi.spyOn(nativeHistory, 'readForkPrefix')
    const result = await probeClaudeFork(candidates)
    expect([...result.values()]).toEqual(ids.map(() => ({ enabled: true })))
    expect(reads).toHaveBeenCalledTimes(2)
    expect(await readFile(file, 'utf8')).toBe(contents)
    expect(await readdir(project)).toEqual([`${sessionId}.jsonl`])
  })
  it('isolates later malformed rows and distinguishes missing selected and ancestor', async () => {
    directory = await mkdtemp(path.join(process.env.TMPDIR!, 'claude-probe-'))
    const project = path.join(directory, 'projects', 'project')
    await mkdir(project, { recursive: true })
    const sessionId = randomUUID(),
      selected = randomUUID(),
      missing = randomUUID()
    const checkpoint = (messageUuid: string) => ({
      runtime: 'claude-code' as const,
      runtimeSessionId: sessionId,
      messageUuid,
      configDir: directory
    })
    await writeFile(
      path.join(project, `${sessionId}.jsonl`),
      JSON.stringify({ uuid: selected, type: 'assistant' }) + '\n{bad\n'
    )
    const result = await probeClaudeFork([
      { messageId: 'early', checkpoint: checkpoint(selected), checkpoints: [checkpoint(selected)], cwd: directory },
      { messageId: 'ancestor', checkpoint: checkpoint(selected), checkpoints: [checkpoint(missing)], cwd: directory },
      { messageId: 'late', checkpoint: checkpoint(missing), checkpoints: [], cwd: directory }
    ])
    expect(result.get('early')).toEqual({ enabled: true })
    expect(result.get('ancestor')).toEqual({ enabled: false, reason: 'history_changed' })
    expect(result.get('late')).toEqual({ enabled: false, reason: 'history_corrupt' })
  })
  it('allows appended history but rejects a changed prefix', async () => {
    directory = await mkdtemp(path.join(process.env.TMPDIR!, 'claude-probe-'))
    const project = path.join(directory, 'projects', 'project')
    await mkdir(project, { recursive: true })
    const session = randomUUID(),
      id = randomUUID()
    const file = path.join(project, `${session}.jsonl`)
    const original = JSON.stringify({ uuid: id, type: 'assistant', text: '中文' }) + '\n'
    await writeFile(file, original)
    const checkpoint = {
      runtime: 'claude-code' as const,
      runtimeSessionId: session,
      messageUuid: id,
      configDir: directory
    }
    const candidate = { messageId: id, checkpoint, checkpoints: [checkpoint], cwd: directory }
    const read = nativeHistory.readForkPrefix
    let calls = 0
    const spy = vi.spyOn(nativeHistory, 'readForkPrefix').mockImplementation(async (name, length) => {
      if (++calls === 2) await writeFile(file, original + '{"extra":true}\n')
      return read(name, length)
    })
    expect((await probeClaudeFork([candidate])).get(id)).toEqual({ enabled: true })
    spy.mockRestore()
    await writeFile(file, original)
    calls = 0
    vi.spyOn(nativeHistory, 'readForkPrefix').mockImplementation(async (name, length) => {
      if (++calls === 2) await writeFile(file, original.replace('中文', '汉字'))
      return read(name, length)
    })
    expect((await probeClaudeFork([candidate])).get(id)).toEqual({ enabled: false, reason: 'history_changed' })
  })
})
