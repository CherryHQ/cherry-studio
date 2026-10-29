import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rmdir, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { assistantTable } from '@data/db/schemas/assistant'
import { topicTable } from '@data/db/schemas/topic'
import { assistantDataService } from '@data/services/AssistantService'
import { BaseService, Emitter } from '@main/core/lifecycle'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import { assistantMemoryAuthority, type MemoryAuthority } from '../memoryAuthority'
import { MemoryService } from '../MemoryService'
import type { MemoryApproval } from '../MemoryStore'

const approve: MemoryApproval = async () => async () => undefined
let fixture: string
let service: MemoryService
const authority = (): MemoryAuthority => ({ scope: { kind: 'shared' }, assertAuthorized: () => undefined })

async function removeFixture(directory: string): Promise<void> {
  if (directory !== fixture && !directory.startsWith(`${fixture}${path.sep}`)) throw new Error('Outside test fixture')
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory() && !entry.isSymbolicLink()) await removeFixture(target)
    else await unlink(target)
  }
  await rmdir(directory)
}

beforeEach(async () => {
  BaseService.resetInstances()
  fixture = await mkdtemp(path.join(os.tmpdir(), 'cherry-memory-service-'))
  vi.spyOn(application, 'getPath').mockImplementation((key, name) => path.join(fixture, key, name ?? ''))
  service = new MemoryService()
})

afterEach(async () => {
  await service['onStop']()
  vi.restoreAllMocks()
  await removeFixture(fixture)
})

describe('lifecycle memory owner', () => {
  const dbh = setupTestDatabase()

  it('does not revive a stored edit after the real assistant setting is disabled and re-enabled', async () => {
    const assistantId = randomUUID()
    const topicId = randomUUID()
    dbh.db
      .insert(assistantTable)
      .values({
        id: assistantId,
        name: 'A',
        emoji: '🌟',
        orderKey: 'a0',
        settings: { ...DEFAULT_ASSISTANT_SETTINGS, enableSharedMemory: true }
      })
      .run()
    dbh.db.insert(topicTable).values({ id: topicId, assistantId, orderKey: 'a0' }).run()
    const caller = assistantMemoryAuthority(
      { kind: 'conversation', topicId, assistantId },
      { assertActive: () => undefined, isHeadless: () => false }
    )
    const session = service.open(caller)
    const read = await session.read('MEMORY.md')
    assistantDataService.update(assistantId, { settings: { enableSharedMemory: false } })
    assistantDataService.update(assistantId, { settings: { enableSharedMemory: true } })
    await expect(
      session.commit([{ kind: 'write', receipt: read.receipt, content: 'Revoked edit' }], approve)
    ).rejects.toThrow('expired')
    expect(await readFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), 'utf8')).toBe('')
  })

  it('shares one scope lock while keeping read receipts private to each caller', async () => {
    const first = service.open(authority())
    const second = service.open(authority())
    const a = await first.read('MEMORY.md')
    const b = await second.read('MEMORY.md')
    await expect(second.commit([{ kind: 'write', receipt: a.receipt, content: 'Stolen' }], approve)).rejects.toThrow()
    const results = await Promise.allSettled([
      first.commit([{ kind: 'write', receipt: a.receipt, content: 'A' }], approve),
      second.commit([{ kind: 'write', receipt: b.receipt, content: 'B' }], approve)
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect((await first.read('MEMORY.md')).content).toMatch(/^[AB]$/)
  })

  it('holds pending approvals in the drain and prevents writes while backup has paused admission', async () => {
    const session = service.open(authority())
    const read = await session.read('MEMORY.md')
    let finishApproval!: () => void
    let entered!: () => void
    const waiting = new Promise<void>((resolve) => {
      entered = resolve
    })
    const result = session.commit([{ kind: 'write', receipt: read.receipt, content: 'Blocked' }], async () => {
      entered()
      await new Promise<void>((resolve) => {
        finishApproval = resolve
      })
      return async () => undefined
    })
    const outcome = result.catch((error: unknown) => error)
    await waiting
    const pause = service.pause('backup')
    expect(await service.drainInFlight({ timeoutMs: 1 })).toEqual({ settled: false })
    await expect(session.read('MEMORY.md')).rejects.toThrow('paused')
    finishApproval()
    expect(await outcome).toBeInstanceOf(Error)
    expect(await service.drainInFlight({ timeoutMs: 1000 })).toEqual({ settled: true })
    pause.dispose()
    expect((await session.read('MEMORY.md')).content).toBe('')
  })

  it('keeps revoked caller receipts invalid after access is re-enabled without revoking other callers', async () => {
    const revoked = new Emitter<void>()
    const first = service.open({ ...authority(), onRevoked: revoked.event })
    const second = service.open(authority())
    const read = await first.read('MEMORY.md')
    revoked.fire()
    await expect(first.commit([{ kind: 'write', receipt: read.receipt, content: 'Expired' }], approve)).rejects.toThrow(
      'expired'
    )
    const other = await second.read('MEMORY.md')
    await second.commit([{ kind: 'write', receipt: other.receipt, content: 'Still authorized' }], approve)
    expect((await second.read('MEMORY.md')).content).toBe('Still authorized')
  })

  it('invalidates pre-restore handles even when restored bytes are identical', async () => {
    const old = service.open(authority())
    const read = await old.read('MEMORY.md')
    service.invalidateAll()
    await expect(old.commit([{ kind: 'write', receipt: read.receipt, content: 'Stale' }], approve)).rejects.toThrow(
      'expired'
    )
    expect((await service.open(authority()).read('MEMORY.md')).content).toBe('')
  })

  it('reports only confirmed changed files and trusted sources to maintenance', async () => {
    const changes: Array<{ source: string; result: { batchId: string | null } }> = []
    service.onChanged((event) => changes.push(event))
    const session = service.open(authority())
    const read = await session.read('MEMORY.md')
    await session.commit([{ kind: 'write', receipt: read.receipt, content: '' }], approve)
    expect(changes).toEqual([])
    await session.commit([{ kind: 'write', receipt: read.receipt, content: 'Saved' }], approve)
    expect(changes).toHaveLength(1)
    expect(changes[0].source).toBe('controlled')
    expect(changes[0].result.batchId).toBeTruthy()
    expect(await readFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), 'utf8')).toBe('Saved')
  })
})
