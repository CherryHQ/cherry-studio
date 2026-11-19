import '@data/services/AgentSessionMessageService'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rmdir, symlink, unlink, writeFile } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentChannelSessionTable } from '@data/db/schemas/agentChannel'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { appStateTable } from '@data/db/schemas/appState'
import { assistantTable } from '@data/db/schemas/assistant'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { SharedMemoryRolloutSeeder } from '@data/db/seeding/seeders/SharedMemoryRolloutSeeder'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentSessionContextService } from '@data/services/AgentSessionContextService'
import { ensureAgentSessionRootTx } from '@data/services/agentSessionMessageTree'
import { assistantDataService } from '@data/services/AssistantService'
import { prepareClaudeBranch } from '@main/ai/runtime/claudeCode/claudeContext'
import { createClaudeCodeIdentityHooks } from '@main/ai/runtime/claudeCode/identityHooks'
import { BaseService, Emitter } from '@main/core/lifecycle'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import {
  agentMemoryAuthority,
  assistantMemoryAuthority,
  editorMemoryAuthority,
  type MemoryAuthority
} from '../memoryAuthority'
import { serializeMemoryEntries } from '../memoryEntries'
import { memoryRuntimeFetch, openRuntimeMemoryGuard, runtimeMemoryAuthorities } from '../memoryRuntime'
import { MemoryService } from '../MemoryService'
import type { MemoryApproval } from '../MemoryStore'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return { ...actual, open: vi.fn(actual.open) }
})

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
  vi.mocked(fs.open).mockReset()
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
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: workspaceId, name: 'W', path: path.join(fixture, workspaceId), orderKey: 'a0' })
      .run()
    dbh.db.insert(agentSessionTable).values({ id: sessionId, agentId, workspaceId, name: 'S', orderKey: 'a0' }).run()
    await mkdir(path.join(fixture, 'feature.agents.data', agentId), { recursive: true })
    return { agentId, sessionId }
  }

  it('retires the native owner on clear and rejects Claude resume even with sharing switched off', async () => {
    const { agentId, sessionId } = await seedAgentSession()
    MockApplicationUtils.setService('MemoryService', service)
    const editor = service.open(authority())
    await editor.entry()
    const file = path.join(fixture, 'feature.memory.data', 'MEMORY.md')
    await fs.writeFile(
      file,
      serializeMemoryEntries([
        {
          schemaVersion: 1,
          id: 'old-home',
          status: 'active',
          text: 'OLD_HOME',
          sources: [],
          derivedFrom: []
        }
      ])
    )
    const stopped = new AbortController()
    const guard = openRuntimeMemoryGuard(sessionId, () => stopped.abort())
    await guard.check()
    const preview = await editor.previewClear()
    await editor.clear(preview.token, approve)
    expect(stopped.signal.aborted).toBe(true)
    await expect(guard.check()).rejects.toThrow('expired')
    guard.dispose()
    agentService.updateAgent(agentId, { configuration: { shared_memory_enabled: false } })
    const hooks = createClaudeCodeIdentityHooks(path.join(fixture, 'feature.agents.data', agentId), sessionId)
    const result = await hooks.SessionStart![0].hooks[0](
      {
        hook_event_name: 'SessionStart',
        source: 'resume',
        session_id: 'native-old',
        transcript_path: '',
        cwd: fixture
      },
      undefined,
      { signal: new AbortController().signal }
    )
    expect(result).toMatchObject({ continue: false })
    expect(JSON.stringify(result)).not.toContain('OLD_HOME')
    expect(await readFile(file, 'utf8')).not.toContain('OLD_HOME')
    const { PiRuntimeConnection } = await import('@main/ai/runtime/pi/PiRuntimeConnection')
    const { ClaudeCodeRuntimeDriver } = await import('@main/ai/runtime/claudeCode/ClaudeCodeRuntimeDriver')
    const { ClaudeCodeSessionStateService } = await import('@main/ai/runtime/claudeCode/ClaudeCodeSessionStateService')
    MockApplicationUtils.setService('ClaudeCodeSessionStateService', new ClaudeCodeSessionStateService())
    const input = { agentId, sessionId, modelId: 'test::test' as const, resumeToken: 'old-native-session' }
    await expect(new PiRuntimeConnection(input).start()).rejects.toThrow('isolation')
    await expect(new ClaudeCodeRuntimeDriver().connect(input)).rejects.toThrow('isolation')
    editor.dispose()
  })

  it.each([true, false])('allows a fresh agent after clear and restart with sharing=%s', async (enabled) => {
    const { sessionId: oldSessionId } = await seedAgentSession()
    MockApplicationUtils.setService('MemoryService', service)
    const editor = service.open(authority())
    await editor.entry()
    await fs.writeFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), 'OLD_HOME')
    const old = openRuntimeMemoryGuard(oldSessionId, () => {})
    await old.check()
    await editor.clear((await editor.previewClear()).token, approve)
    old.dispose()
    editor.dispose()
    const { sessionId, agentId } = await seedAgentSession()
    agentService.updateAgent(agentId, { configuration: { shared_memory_enabled: enabled } })
    const fresh = openRuntimeMemoryGuard(sessionId, () => {})
    try {
      await fresh.check()
    } finally {
      fresh.dispose()
    }
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        sessionId,
        parentId: ensureAgentSessionRootTx(dbh.db, sessionId),
        role: 'assistant',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'New answer' }] }
      })
      .run()
    await service._doStop()
    BaseService.resetInstances()
    service = new MemoryService()
    MockApplicationUtils.setService('MemoryService', service)
    const resumed = openRuntimeMemoryGuard(sessionId, () => {})
    const stale = openRuntimeMemoryGuard(oldSessionId, () => {})
    try {
      await resumed.check()
      await expect(stale.check()).rejects.toThrow('isolation')
    } finally {
      resumed.dispose()
      stale.dispose()
    }
  })

  it.each([true, false])('allows a fresh assistant after clear with sharing=%s', async (enabled) => {
    MockApplicationUtils.setService('MemoryService', service)
    const editor = service.open(authority())
    await editor.entry()
    await fs.writeFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), 'OLD_HOME')
    await editor.clear((await editor.previewClear()).token, approve)
    editor.dispose()
    const assistantId = randomUUID()
    const topicId = randomUUID()
    dbh.db
      .insert(assistantTable)
      .values({
        id: assistantId,
        name: 'A',
        emoji: '',
        prompt: '',
        settings: { ...DEFAULT_ASSISTANT_SETTINGS, enableSharedMemory: enabled },
        orderKey: 'a0'
      })
      .run()
    dbh.db.insert(topicTable).values({ id: topicId, assistantId, orderKey: 'a0' }).run()
    const rootId = randomUUID()
    const userId = randomUUID()
    const replyId = randomUUID()
    dbh.db
      .insert(messageTable)
      .values({ id: rootId, topicId, role: 'root', status: 'success', data: { parts: [] } })
      .run()
    dbh.db
      .insert(messageTable)
      .values({
        id: userId,
        parentId: rootId,
        topicId,
        role: 'user',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'Hello' }] }
      })
      .run()
    dbh.db
      .insert(messageTable)
      .values({ id: replyId, parentId: userId, topicId, role: 'assistant', status: 'pending', data: { parts: [] } })
      .run()
    const transport = memoryRuntimeFetch(
      async () => Response.json({ answer: 'OK' }),
      (signal) => runtimeMemoryAuthorities({ topicId, assistantId }, signal)
    )
    expect(await (await transport('https://test.invalid')).json()).toEqual({ answer: 'OK' })
    dbh.db.update(messageTable).set({ status: 'success' }).where(eq(messageTable.id, replyId)).run()
    if (!enabled) {
      const later = service.open(authority())
      const onDisk = await fs.readFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), 'utf8')
      await fs.writeFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), `${onDisk}\nAnother preference`)
      await later.clear((await later.previewClear()).token, approve)
      later.dispose()
    }
    await service._doStop()
    BaseService.resetInstances()
    service = new MemoryService()
    MockApplicationUtils.setService('MemoryService', service)
    expect(await (await transport('https://test.invalid')).json()).toEqual({ answer: 'OK' })
    // Older installs may retain only a compaction summary and have no isolation record.
    dbh.db.delete(appStateTable).run()
    dbh.db.update(messageTable).set({ compactionSummary: 'OLD_HOME' }).where(eq(messageTable.id, userId)).run()
    await expect(transport('https://test.invalid')).rejects.toThrow('isolation')
  })

  it.each([false, true])(
    'baselines pre-rollout history only on a pre-feature database (preview=%s)',
    async (preview) => {
      MockApplicationUtils.setService('MemoryService', service)
      const assistantId = randomUUID()
      const topicId = randomUUID()
      dbh.db
        .insert(assistantTable)
        .values({
          id: assistantId,
          name: 'A',
          emoji: '',
          prompt: '',
          settings: DEFAULT_ASSISTANT_SETTINGS,
          orderKey: 'a0'
        })
        .run()
      dbh.db.insert(topicTable).values({ id: topicId, assistantId, orderKey: 'a0' }).run()
      dbh.db
        .insert(appStateTable)
        .values({ key: 'seedRunner:bootstrapCompleted', value: { completedAt: 1 } })
        .run()
      if (preview)
        dbh.db
          .insert(appStateTable)
          .values({ key: 'memory:runtime:other', value: { version: 1, protection: null } })
          .run()
      const rootId = randomUUID()
      dbh.db
        .insert(messageTable)
        .values({ id: rootId, topicId, role: 'root', status: 'success', data: { parts: [] } })
        .run()
      dbh.db
        .insert(messageTable)
        .values({
          id: randomUUID(),
          parentId: rootId,
          topicId,
          role: 'assistant',
          status: 'success',
          data: { parts: [] }
        })
        .run()
      new SharedMemoryRolloutSeeder().run(dbh.db)
      const editor = service.open(authority())
      await editor.entry()
      await fs.writeFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), 'CLEARED')
      await editor.clear((await editor.previewClear()).token, approve)
      editor.dispose()
      const run = memoryRuntimeFetch(
        async () => Response.json({}),
        (signal) => runtimeMemoryAuthorities({ topicId, assistantId }, signal)
      )
      const request = run('https://test.invalid')
      if (preview) await expect(request).rejects.toThrow('isolation')
      else expect((await request).ok).toBe(true)
    }
  )

  it.each(['reply', 'native', 'resume-token'] as const)('rejects unrecorded old Agent %s history', async (kind) => {
    const { sessionId } = await seedAgentSession()
    if (kind === 'native') {
      const context = prepareClaudeBranch(sessionId, fixture, 'old-native')
      agentSessionContextService.bindContext(context.id, 'old-native')
    } else
      dbh.db
        .insert(agentSessionMessageTable)
        .values({
          sessionId,
          parentId: ensureAgentSessionRootTx(dbh.db, sessionId),
          role: kind === 'reply' ? 'assistant' : 'user',
          runtimeResumeToken: kind === 'resume-token' ? 'old-native' : null,
          status: 'success',
          data: { parts: [{ type: 'text', text: 'OLD_HOME' }] }
        })
        .run()
    MockApplicationUtils.setService('MemoryService', service)
    const editor = service.open(authority())
    await editor.entry()
    await fs.writeFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), 'OLD_HOME')
    await editor.clear((await editor.previewClear()).token, approve)
    editor.dispose()
    const guard = openRuntimeMemoryGuard(sessionId, () => {})
    try {
      await expect(guard.check()).rejects.toThrow('isolation')
    } finally {
      guard.dispose()
    }
  })

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

  it.each(['before', 'writeFile', 'sync'] as const)(
    'keeps real assistant revocation effective during %s',
    async (stage) => {
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
      const revoke = () => {
        assistantDataService.update(assistantId, { settings: { enableSharedMemory: false } })
        assistantDataService.update(assistantId, { settings: { enableSharedMemory: true } })
      }
      if (stage === 'before') revoke()
      else {
        const actual = await vi.importActual<typeof fs>('node:fs/promises')
        vi.mocked(fs.open).mockImplementation(async (...args) => {
          const handle = await actual.open(...args)
          if (String(args[0]).startsWith(path.join(fixture, 'feature.memory.data', 'MEMORY.md.tmp-'))) {
            const original = handle[stage].bind(handle)
            vi.spyOn(handle, stage).mockImplementation(async (...values: unknown[]) => {
              const result = await Reflect.apply(original, handle, values)
              revoke()
              return result
            })
          }
          return handle
        })
      }
      const pending = session.commit([{ kind: 'write', receipt: read.receipt, content: 'Revoked edit' }], approve)
      if (stage === 'before') await expect(pending).rejects.toThrow('expired')
      else expect((await pending).error).toBe('Memory session expired')
      await expect(session.read('MEMORY.md')).rejects.toThrow('expired')
      expect(await readFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), 'utf8')).toBe('')
    }
  )

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

  it('reloads the entry snapshot after restored state invalidates the service', async () => {
    const initial = service.open(authority())
    const read = await initial.read('MEMORY.md')
    await initial.commit([{ kind: 'write', receipt: read.receipt, content: 'Before restore' }], approve)
    expect((await service.entrySnapshot('conversation', service.open(authority()))).content).toBe('Before restore')
    await writeFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), 'Restored content')
    service.invalidateAll()
    const restored = service.open(authority())
    expect((await service.entrySnapshot('conversation', restored)).content).toBe('Restored content')
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
