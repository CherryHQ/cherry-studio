import '@data/services/AgentSessionMessageService'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rmdir, symlink, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentChannelSessionTable } from '@data/db/schemas/agentChannel'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { assistantTable } from '@data/db/schemas/assistant'
import { topicTable } from '@data/db/schemas/topic'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { assistantDataService } from '@data/services/AssistantService'
import { BaseService, Emitter } from '@main/core/lifecycle'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import {
  agentMemoryAuthority,
  assistantMemoryAuthority,
  editorMemoryAuthority,
  type MemoryAuthority
} from '../memoryAuthority'
import { MemoryService } from '../MemoryService'
import type { MemoryApproval } from '../MemoryStore'

const approve: MemoryApproval = async () => () => undefined
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
  MockApplicationUtils.resetServices()
  await removeFixture(fixture)
})

describe('lifecycle memory owner', () => {
  const dbh = setupTestDatabase()

  it('rejects a linked backup ancestor before creating a backup directory', async () => {
    const outside = path.join(fixture, 'outside')
    await mkdir(outside)
    await symlink(outside, application.getPath('feature.memory.backups'), 'junction')
    await expect(service.open(authority()).read('MEMORY.md')).rejects.toMatchObject({ code: 'invalid-path' })
    expect(await readdir(outside)).toEqual([])
  })

  it('signals history replacement only for a restored filesystem', () => {
    const replaced = vi.fn()
    service.onHistoryReplaced(replaced)
    service.pause('backup').dispose()
    expect(replaced).not.toHaveBeenCalled()
    service.invalidateAll()
    expect(replaced).toHaveBeenCalledTimes(1)
  })

  it('keeps correction metadata in maintenance reads and out of native current reads', async () => {
    const native = service.open(authority())
    const empty = await native.read('MEMORY.md')
    await native.commit([{ kind: 'write', receipt: empty.receipt, content: '- "Old fact"\n' }], approve)
    const correction = {
      quote: 'Old fact',
      text: 'New fact',
      reason: 'corrected' as const,
      recordedAt: '2026-11-17T10:00:00.000Z',
      sources: [{ kind: 'chat' as const, conversationId: 't', messageId: 'm', sourceVersion: 'v' }]
    }
    await expect(native.prepareRevisions(empty.receipt, [correction])).rejects.toThrow('Only extraction')
    const extraction = service.open(authority(), 'extraction')
    const proposal = await extraction.prepareRevisions((await extraction.read('MEMORY.md')).receipt, [correction])
    await extraction.commit([proposal], approve)
    const visible = await native.read('MEMORY.md')
    expect(visible.receipt).not.toBe('')
    expect(visible.content).not.toContain('Old fact')
    const organizer = service.open(authority(), 'dreaming')
    const full = await organizer.read('MEMORY.md')
    expect(full.content).toContain('retirement')
    expect(full.receipt).not.toBe('')
    expect(await native.revisions()).toHaveLength(1)
    await organizer.commit([{ kind: 'write', receipt: full.receipt, content: `${full.content}\n` }], approve)
  })

  async function seedAgentSession() {
    const agentId = randomUUID()
    const sessionId = randomUUID()
    const workspaceId = randomUUID()
    dbh.db.insert(agentTable).values({ id: agentId, type: 'pi', name: 'A', instructions: '', orderKey: 'a0' }).run()
    dbh.db.insert(agentWorkspaceTable).values({ id: workspaceId, name: 'W', path: fixture, orderKey: 'a0' }).run()
    dbh.db.insert(agentSessionTable).values({ id: sessionId, agentId, workspaceId, name: 'S', orderKey: 'a0' }).run()
    await mkdir(path.join(fixture, 'feature.agents.data', agentId), { recursive: true })
    return { agentId, sessionId }
  }

  it.each(['disable', 'owner'] as const)(
    'permanently expires a channel edit after %s and restoration',
    async (change) => {
      const { agentId, sessionId } = await seedAgentSession()
      const channel = agentChannelService.createChannel({
        name: 'Channel',
        type: 'telegram',
        agentId,
        workspace: { type: 'system' },
        config: { bot_token: 'test-token', allowed_chat_ids: [] },
        isActive: true
      })
      dbh.db.insert(agentChannelSessionTable).values({ channelId: channel.id, sessionId }).run()
      const open = () =>
        service.open(
          agentMemoryAuthority(sessionId, 'private', {
            assertActive: () => undefined,
            isHeadless: () => false
          })
        )
      const session = open()
      const read = await session.read('MEMORY.md')
      await expect(
        session.commit([{ kind: 'write', receipt: read.receipt, content: 'Stale' }], async () => {
          agentChannelService.updateChannel(channel.id, change === 'disable' ? { isActive: false } : { agentId: null })
          agentChannelService.updateChannel(channel.id, { isActive: true, agentId })
          return () => undefined
        })
      ).rejects.toThrow('expired')
      await expect(session.read('MEMORY.md')).rejects.toThrow('expired')
      const fresh = open()
      const current = await fresh.read('MEMORY.md')
      expect(current.content).toBe('')
      await fresh.commit([{ kind: 'write', receipt: current.receipt, content: 'Fresh read' }], approve)
      expect((await fresh.read('MEMORY.md')).content).toBe('Fresh read')
    }
  )

  it('keeps a channel receipt valid after a rename or an unrelated channel is disabled', async () => {
    const { agentId, sessionId } = await seedAgentSession()
    const data = {
      name: 'Channel',
      type: 'telegram' as const,
      agentId,
      workspace: { type: 'system' as const },
      config: { bot_token: 'test-token', allowed_chat_ids: [] },
      isActive: true
    }
    const channel = agentChannelService.createChannel(data)
    const other = agentChannelService.createChannel(data)
    dbh.db.insert(agentChannelSessionTable).values({ channelId: channel.id, sessionId }).run()
    const session = service.open(
      agentMemoryAuthority(sessionId, 'private', {
        assertActive: () => undefined,
        isHeadless: () => false
      })
    )
    const read = await session.read('MEMORY.md')
    agentChannelService.updateChannel(channel.id, { name: 'Renamed' })
    agentChannelService.updateChannel(other.id, { isActive: false })
    await session.commit([{ kind: 'write', receipt: read.receipt, content: 'Still authorized' }], approve)
    expect((await session.read('MEMORY.md')).content).toBe('Still authorized')
  })

  it('expires a private editor when its Agent is deleted and restored during approval', async () => {
    const { agentId } = await seedAgentSession()
    MockApplicationUtils.setService('WindowManager', { getWindowType: () => 'main', getWindow: () => ({}) })
    const open = () => service.open(editorMemoryAuthority('main', { kind: 'private', agentId }))
    const session = open()
    const read = await session.read('MEMORY.md')
    await expect(
      session.commit([{ kind: 'write', receipt: read.receipt, content: 'Stale editor' }], async () => {
        agentService.deleteAgent(agentId)
        agentService.restoreAgent(agentId)
        return () => undefined
      })
    ).rejects.toThrow('expired')
    await expect(session.read('MEMORY.md')).rejects.toThrow('expired')
    const fresh = open()
    const current = await fresh.read('MEMORY.md')
    expect(current.content).toBe('')
    await fresh.commit([{ kind: 'write', receipt: current.receipt, content: 'Fresh editor' }], approve)
    expect((await fresh.read('MEMORY.md')).content).toBe('Fresh editor')
  })

  it('reopens admission after lifecycle initialization without reviving old sessions', async () => {
    await service._doInit()
    const old = service.open(authority())
    await old.read('MEMORY.md')
    await service._doStop()
    await service._doInit()
    await expect(old.read('MEMORY.md')).rejects.toThrow('expired')
    expect((await service.open(authority()).read('MEMORY.md')).content).toBe('')
  })

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
      return () => undefined
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
