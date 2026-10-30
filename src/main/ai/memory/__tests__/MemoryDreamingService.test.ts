import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { loggerService } from '@logger'
import type { JobContext } from '@main/core/job/types'
import { BaseService } from '@main/core/lifecycle'

import { MemoryDreamingService } from '../MemoryDreamingService'
import { needsDreaming, observeMemory, readDreamingState, writeDreamingState } from '../memoryDreamingState'
import { memoryHash } from '../memoryFiles'
import { MemoryService, type MemorySession } from '../MemoryService'

describe('memory organization lifecycle and commit fences', () => {
  const dbh = setupTestDatabase()
  const scope = { kind: 'shared' } as const
  const approve = async () => () => undefined
  const generate = vi.fn(async () => ({ text: '{"writes":[],"deletes":[]}', finishReason: 'stop' }))
  const busy = vi.fn(() => false)
  let fixture: string
  let memory: MemoryService
  let dreaming: MemoryDreamingService
  let session: MemorySession

  async function removeFixture(directory: string): Promise<void> {
    if (directory !== fixture && !directory.startsWith(`${fixture}${path.sep}`)) throw new Error('Outside fixture')
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory() && !entry.isSymbolicLink()) await removeFixture(target)
      else await unlink(target)
    }
    await rmdir(directory)
  }

  const job = (): JobContext<Record<string, never>> => ({
    jobId: 'memory-test',
    input: {},
    attempt: 1,
    parentId: null,
    metadata: {},
    signal: new AbortController().signal,
    patchMetadata: async () => undefined,
    reportProgress: () => undefined,
    logger: loggerService.withContext('MemoryDreamingTest')
  })

  beforeEach(async () => {
    BaseService.resetInstances()
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', 'fixture::gpt-4o')
    generate.mockReset().mockResolvedValue({ text: '{"writes":[],"deletes":[]}', finishReason: 'stop' })
    busy.mockReset().mockReturnValue(false)
    fixture = await mkdtemp(path.join(os.tmpdir(), 'cherry-memory-dreaming-'))
    vi.spyOn(application, 'getPath').mockImplementation((key, name) => path.join(fixture, key, name ?? ''))
    dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'fixture', name: 'Fixture', orderKey: 'a0', isEnabled: true })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'fixture::gpt-4o',
        providerId: 'fixture',
        modelId: 'gpt-4o',
        name: 'Fixture',
        capabilities: [],
        supportsStreaming: true,
        contextWindow: 128000,
        maxInputTokens: 100000,
        maxOutputTokens: 32000,
        orderKey: 'a0'
      })
      .run()
    memory = new MemoryService()
    dreaming = new MemoryDreamingService()
    MockApplicationUtils.setService('MemoryService', memory)
    MockApplicationUtils.setService('AiService', { generateText: generate })
    MockApplicationUtils.setService('AgentSessionRuntimeService', { hasBusySessions: busy })
    MockApplicationUtils.setService('AiStreamManager', { listActiveWork: () => [] })
    await memory._doInit()
    await dreaming._doInit()
    session = memory.open({ scope, assertAuthorized: () => undefined })
  })

  afterEach(async () => {
    await dreaming._doStop()
    session.dispose()
    await memory._doStop()
    MockApplicationUtils.resetServices()
    vi.restoreAllMocks()
    await removeFixture(fixture)
  })

  async function save(content: string, target = 'MEMORY.md') {
    const read = await session.read(target)
    return session.commit([{ kind: 'write', receipt: read.receipt, content }], approve)
  }

  it('counts only changed controlled writes and keeps the earliest pending time across recovery', async () => {
    await save('First fact')
    const initial = readDreamingState(scope).files['MEMORY.md']
    expect(initial).toMatchObject({ changes: 1, pendingSince: expect.any(Number) })
    await save('First fact')
    await save('Second fact')
    const recovery = await session.previewRecovery()
    await session.recover(recovery!.token, approve)
    expect((await session.read('MEMORY.md')).content).toBe('First fact')
    const file = readDreamingState(scope).files['MEMORY.md']
    expect(file.changes).toBe(2)
    expect(file.pendingSince).toBe(initial.pendingSince)
    expect(needsDreaming(file, initial.pendingSince! + 7 * 24 * 60 * 60_000)).toBe(true)
  })

  it('runs an explicit request with automatic organization off and persists no-op progress without file bodies', async () => {
    await save('Keep this complete fact')
    await application.get('PreferenceService').set('feature.memory.dreaming.enabled', false)
    dreaming.request(scope)
    expect(await dreaming.execute(job())).toMatchObject({ checked: 1, changed: 0 })
    expect((await session.read('MEMORY.md')).content).toBe('Keep this complete fact')
    expect(readDreamingState(scope).files['MEMORY.md']).toMatchObject({ changes: 0, processedAt: expect.any(Number) })
    expect(readDreamingState(scope).files['MEMORY.md'].pendingSince).toBeUndefined()
    expect(JSON.stringify(dbh.db.select().from(appStateTable).all())).not.toContain('Keep this complete fact')
  })

  it.each(['cancel', 'disable', 'foreground', 'external-edit', 'clear'] as const)(
    'does not publish delayed model output after %s',
    async (action) => {
      await save('Original fact')
      const response = Promise.withResolvers<{ text: string; finishReason: string }>()
      generate.mockImplementationOnce(() => response.promise)
      dreaming.request(scope)
      const outcome = dreaming.execute(job()).catch((error: unknown) => error)
      await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
      if (action === 'cancel') dreaming.cancel(scope)
      if (action === 'disable') await application.get('PreferenceService').set('feature.memory.dreaming.enabled', false)
      if (action === 'foreground') busy.mockReturnValue(true)
      if (action === 'external-edit')
        await writeFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), 'External edit')
      if (action === 'clear') await session.clear((await session.previewClear()).token, approve)
      response.resolve({
        text: '{"writes":[{"path":"MEMORY.md","content":"Stale model output"}],"deletes":[]}',
        finishReason: 'stop'
      })
      expect(await outcome).toBeInstanceOf(Error)
      expect(await readFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), 'utf8')).toBe(
        action === 'external-edit' ? 'External edit' : action === 'clear' ? '' : 'Original fact'
      )
    }
  )

  it('rejects deletion while another memory file still links to the source', async () => {
    await save('[Details](.memories/old.md)')
    await save('Fact with its exception', '.memories/old.md')
    generate.mockResolvedValueOnce({
      text: JSON.stringify({
        writes: [{ path: '.memories/new.md', content: 'Fact with its exception' }],
        deletes: [{ path: '.memories/old.md', transferTo: '.memories/new.md' }]
      }),
      finishReason: 'stop'
    })
    dreaming.request(scope)
    await expect(dreaming.execute(job())).rejects.toMatchObject({ reason: 'output' })
    expect((await session.read('.memories/old.md')).content).toBe('Fact with its exception')
    expect((await session.read('.memories/new.md')).content).toBeNull()
  })

  it('writes the complete destination and updated link before removing the transferred topic', async () => {
    await save('[Details](.memories/old.md)')
    await save('Fact with its exception', '.memories/old.md')
    generate.mockResolvedValueOnce({
      text: JSON.stringify({
        writes: [
          { path: '.memories/new.md', content: 'Fact with its exception' },
          { path: 'MEMORY.md', content: '[Details](.memories/new.md)' }
        ],
        deletes: [{ path: '.memories/old.md', transferTo: '.memories/new.md' }]
      }),
      finishReason: 'stop'
    })
    dreaming.request(scope)
    expect(await dreaming.execute(job())).toMatchObject({ changed: 3, checked: 3 })
    expect((await session.read('MEMORY.md')).content).toBe('[Details](.memories/new.md)')
    expect((await session.read('.memories/new.md')).content).toBe('Fact with its exception')
    expect((await session.read('.memories/old.md')).content).toBeNull()
    expect(readDreamingState(scope).files['.memories/new.md'].changes).toBe(0)
    const recovery = await session.previewRecovery()
    await session.recover(recovery!.token, approve)
    expect((await session.read('MEMORY.md')).content).toBe('[Details](.memories/old.md)')
    expect((await session.read('.memories/old.md')).content).toBe('Fact with its exception')
    expect((await session.read('.memories/new.md')).content).toBeNull()
  })

  it('preserves the seven-day deadline when external content changes without inventing edits', () => {
    const state = readDreamingState(scope)
    const original = { path: 'MEMORY.md', content: 'First', hash: memoryHash(Buffer.from('First')) }
    observeMemory(state, original, 1000)
    writeDreamingState(state)
    const restored = readDreamingState(scope)
    observeMemory(restored, { ...original, content: 'Second', hash: memoryHash(Buffer.from('Second')) }, 2000)
    expect(restored.files['MEMORY.md']).toMatchObject({ changes: 0, pendingSince: 1000 })
    expect(needsDreaming(restored.files['MEMORY.md'], 1000 + 7 * 24 * 60 * 60_000)).toBe(true)
  })

  it('abandons a queued generation on lifecycle restart', async () => {
    dreaming.request(scope)
    const previous = readDreamingState(scope).generation
    await dreaming._doStop()
    await dreaming._doInit()
    expect(readDreamingState(scope)).toMatchObject({ generation: previous + 1, manual: false, status: 'cancelled' })
  })
})
