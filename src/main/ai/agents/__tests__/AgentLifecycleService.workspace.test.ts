import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionService } from '@data/services/AgentSessionService'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { aiHandlers } from '@main/ipc/handlers/ai'
import { aiRequestSchemas } from '@shared/ipc/schemas/ai'

import { AgentLifecycleService } from '../AgentLifecycleService'
import { sweepAgentOrphans } from '../agentOrphanSweep'
import * as workspaceArchive from '../agentWorkspaceStorage'
import { agentWorkspaceStorageService } from '../AgentWorkspaceStorageService'

const mocks = vi.hoisted(() => ({
  busyForArchive: vi.fn().mockReturnValue(false),
  closeSession: vi.fn().mockResolvedValue(undefined),
  closeSessionForArchive: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AiStreamManager: {
      isWriteQuiesced: false,
      withDispatchLock: (_id: string, operation: () => Promise<unknown>) => operation(),
      hasUnsettledTopicWork: () => false,
      abortAndDrain: async () => {},
      pauseRuntimeTurn: () => {}
    },
    AgentSessionRuntimeService: {
      cancelSessionForks: async () => {},
      recoverSessionForks: async () => {},
      isSessionBusy: () => false,
      isSessionBusyForArchive: mocks.busyForArchive,
      closeSession: mocks.closeSession,
      closeSessionForArchive: mocks.closeSessionForArchive
    },
    AgentSessionDeliveryService: {
      pause: () => ({ dispose() {} }),
      drainSessionQueues: async () => {},
      kick: () => {}
    },
    ChannelManager: { reconcileAgent: () => {} }
  } as Parameters<typeof mockApplicationFactory>[0])
})

describe(`Agent lifecycle workspace persistence (${process.platform})`, () => {
  const dbh = setupTestDatabase()
  let root: string
  let lifecycle: AgentLifecycleService

  beforeEach(async () => {
    BaseService.resetInstances()
    mocks.closeSession.mockResolvedValue(undefined)
    mocks.busyForArchive.mockReturnValue(false)
    mocks.closeSessionForArchive.mockResolvedValue(undefined)
    root = await mkdtemp(path.join(os.tmpdir(), 'lifecycle-workspace-'))
    const getPath = vi.mocked(application.getPath).getMockImplementation()!
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
      key === 'feature.agents.system_workspaces' || key === 'feature.agents.data' ? root : getPath(key, filename)
    )
    lifecycle = new AgentLifecycleService()
    dbh.db
      .insert(agentTable)
      .values({ id: 'agent', name: 'Agent', type: 'claude-code', instructions: '', orderKey: 'a0' })
      .run()
    for (const type of ['system', 'user'] as const) {
      const workspace = path.join(root, '2026-10-12', type)
      await mkdir(workspace, { recursive: true })
      await writeFile(path.join(workspace, 'output.txt'), `${type} output`)
      dbh.db
        .insert(agentWorkspaceTable)
        .values({ id: type, name: type, type, path: workspace, orderKey: type === 'system' ? 'a0' : 'a1' })
        .run()
      dbh.db
        .insert(agentSessionTable)
        .values({
          id: type,
          agentId: 'agent',
          workspaceId: type,
          name: type,
          orderKey: type === 'system' ? 'a0' : 'a1'
        })
        .run()
    }
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    BaseService.resetInstances()
    await rm(root, { recursive: true, force: true })
  })

  const workspacePath = (root: string, id: string) => path.join(root, '2026-10-12', id)
  const registerWorkspace = async (workspacePath: string) => {
    return aiHandlers['ai.agent.workspace.register'](
      aiRequestSchemas['ai.agent.workspace.register'].input.parse({ path: workspacePath }),
      { senderId: 'test-window' }
    )
  }

  it('registers through IPC idempotently without renaming an existing workspace', async () => {
    const registeredPath = path.join(root, 'registered-project')
    const register = (name: string) =>
      aiHandlers['ai.agent.workspace.register'](
        aiRequestSchemas['ai.agent.workspace.register'].input.parse({ path: registeredPath, name }),
        { senderId: 'test-window' }
      )
    const first = await register('Project')
    const second = await register('Ignored rename')
    expect(second.id).toBe(first.id)
    expect(second.name).toBe('Project')
    expect(
      dbh.db.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.path, registeredPath)).all()
    ).toHaveLength(1)
  })

  it.each(['archive', 'purge', 'retention'] as const)(
    'preserves a registered descendant user workspace through %s and sweeps',
    async (mode) => {
      const parent = workspacePath(root, 'system')
      const nested = path.join(parent, 'project')
      await mkdir(nested)
      await writeFile(path.join(nested, 'keep.txt'), 'user work')
      const workspace = await registerWorkspace(nested)
      const session = agentSessionService.create({
        agentId: 'agent',
        name: 'Nested',
        workspace: { type: 'user', workspaceId: workspace.id }
      })
      await lifecycle.archiveSessions(['system'])
      if (mode === 'purge') await lifecycle.purgeSessions(['system'])
      if (mode === 'retention') await lifecycle.purgeExpiredSessions(Number.MAX_SAFE_INTEGER, 10)
      const stale = new Date(Date.now() - 3_600_000)
      for (const target of [path.join(nested, 'keep.txt'), nested, path.join(parent, 'output.txt'), parent])
        await utimes(target, stale, stale)
      await lifecycle.sweepOrphans()
      await lifecycle.sweepOrphans()
      expect(await readFile(path.join(nested, 'keep.txt'), 'utf8')).toBe('user work')
      expect(existsSync(`${parent}.tar.gz`)).toBe(false)
      expect(
        dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, session.id)).get()?.deletedAt
      ).toBeNull()
      expect(
        dbh.db.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, workspace.id)).get()?.path
      ).toBe(nested)
    }
  )

  it('protects descendant workspaces registered through a directory alias', async () => {
    const parent = workspacePath(root, 'system')
    const alias = path.join(root, 'alias')
    await mkdir(path.join(parent, 'project'))
    await symlink(parent, alias, 'junction')
    await registerWorkspace(path.join(alias, 'project'))
    await lifecycle.archiveSessions(['system'])
    expect(await readFile(path.join(parent, 'output.txt'), 'utf8')).toBe('system output')
    expect(existsSync(`${parent}.tar.gz`)).toBe(false)
  })

  it('releases the storage reservation when strict runtime shutdown fails', async () => {
    mocks.closeSessionForArchive.mockRejectedValueOnce(new Error('shutdown failed'))
    await lifecycle.archiveSessions(['system'])
    const nested = path.join(workspacePath(root, 'system'), 'project')
    expect((await registerWorkspace(nested)).path).toBe(nested)
  })
  it('blocks overlapping registration throughout archive shutdown and releases the reservation afterward', async () => {
    const parent = workspacePath(root, 'system')
    const nested = path.join(parent, 'project')
    const entered = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    mocks.closeSessionForArchive.mockImplementationOnce(async () => {
      entered.resolve()
      await resume.promise
    })
    const archiving = lifecycle.archiveSessions(['system'])
    await entered.promise
    try {
      await expect(registerWorkspace(nested)).rejects.toThrow()
      await expect(registerWorkspace(`${parent}.restoring`)).rejects.toThrow()
      await expect(registerWorkspace(` ${nested} `)).rejects.toThrow()
      expect((await registerWorkspace(path.join(root, 'unrelated'))).path).toBe(path.join(root, 'unrelated'))
    } finally {
      resume.resolve()
      await archiving
    }
    expect((await registerWorkspace(nested)).path).toBe(nested)
  })
  it.each([
    ['session', '.restoring'],
    ['agent', '.restoring'],
    ['session', '.archiving'],
    ['agent', '.archiving'],
    ['session', ''],
    ['agent', '']
  ] as const)('blocks %s restore when user files occupy the %s storage path', async (mode, suffix) => {
    const parent = workspacePath(root, 'system')
    if (mode === 'agent') await lifecycle.archiveAgent('agent', { archiveSessions: true })
    else await lifecycle.archiveSessions(['system'])
    const originalArchive = await readFile(`${parent}.tar.gz`)
    const nested = path.join(`${parent}${suffix}`, 'project')
    await mkdir(nested, { recursive: true })
    await writeFile(path.join(nested, 'keep.txt'), 'created after archival')
    dbh.db
      .insert(agentTable)
      .values({ id: 'other-agent', name: 'Other', type: 'claude-code', instructions: '', orderKey: 'a1' })
      .run()
    const workspace = await registerWorkspace(nested)
    const otherSession = agentSessionService.create({
      agentId: 'other-agent',
      name: 'Other',
      workspace: { type: 'user', workspaceId: workspace.id }
    })

    const restore = () => (mode === 'agent' ? lifecycle.restoreAgent('agent') : lifecycle.restoreSession('system'))
    await expect(restore()).rejects.toThrow('cannot safely restore')
    expect(await readFile(path.join(nested, 'keep.txt'), 'utf8')).toBe('created after archival')
    expect(await readFile(`${parent}.tar.gz`)).toEqual(originalArchive)
    expect(
      dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'system')).get()?.deletedAt
    ).not.toBeNull()
    expect(
      dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, otherSession.id)).get()?.deletedAt
    ).toBeNull()
    if (mode === 'agent')
      expect(dbh.db.select().from(agentTable).where(eq(agentTable.id, 'agent')).get()?.deletedAt).not.toBeNull()
  })

  it.each(['session', 'agent'] as const)('holds the storage reservation throughout %s restoration', async (mode) => {
    const parent = workspacePath(root, 'system')
    const caseAlias = existsSync(workspacePath(root, 'SYSTEM'))
    if (mode === 'agent') await lifecycle.archiveAgent('agent', { archiveSessions: true })
    else await lifecycle.archiveSessions(['system'])
    const entered = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    const restoreFiles = workspaceArchive.unpackWorkspaceArchive
    vi.spyOn(workspaceArchive, 'unpackWorkspaceArchive').mockImplementationOnce(async (archive, workspace) => {
      entered.resolve()
      await resume.promise
      return restoreFiles(archive, workspace)
    })
    const restoring = mode === 'agent' ? lifecycle.restoreAgent('agent') : lifecycle.restoreSession('system')
    await entered.promise
    try {
      await expect(registerWorkspace(path.join(`${parent}.restoring`, 'project'))).rejects.toThrow()
      await expect(registerWorkspace(path.join(parent, 'project'))).rejects.toThrow()
      const variant = path.join(`${parent}.RESTORING`, 'project')
      const registration = registerWorkspace(variant)
      if (caseAlias) await expect(registration).rejects.toThrow()
      else expect((await registration).path).toBe(variant)
      expect(
        dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'system')).get()?.deletedAt
      ).not.toBeNull()
    } finally {
      resume.resolve()
      await restoring
    }
    expect(await readFile(path.join(parent, 'output.txt'), 'utf8')).toBe('system output')
    expect((await registerWorkspace(path.join(parent, 'project'))).path).toBe(path.join(parent, 'project'))
  })
  it.each(['session', 'agent'] as const)('restores %s despite an unrelated claim beneath a file', async (mode) => {
    const old = path.join(root, 'old')
    const claimed = path.join(old, 'task')
    await mkdir(claimed, { recursive: true })
    const workspace = await registerWorkspace(claimed)
    await rm(old, { recursive: true })
    await writeFile(old, 'replaced directory')

    if (mode === 'agent') {
      await lifecycle.archiveAgent('agent', { archiveSessions: true })
      expect(existsSync(`${workspacePath(root, 'system')}.tar.gz`)).toBe(true)
      await lifecycle.restoreAgent('agent')
      expect(dbh.db.select().from(agentTable).where(eq(agentTable.id, 'agent')).get()?.deletedAt).toBeNull()
    } else {
      await lifecycle.archiveSessions(['system'])
      expect(existsSync(`${workspacePath(root, 'system')}.tar.gz`)).toBe(true)
      await lifecycle.restoreSession('system')
    }
    expect(await readFile(path.join(workspacePath(root, 'system'), 'output.txt'), 'utf8')).toBe('system output')
    expect(
      dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'system')).get()?.deletedAt
    ).toBeNull()
    expect(dbh.db.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, workspace.id)).get()?.path).toBe(
      claimed
    )
    expect(agentWorkspaceStorageService.reserveWorkspaceStorage([old])).toBeUndefined()
    expect(await readFile(old, 'utf8')).toBe('replaced directory')
    await lifecycle.archiveSessions(['system'])
    await lifecycle.purgeSessions(['system'])
    expect(existsSync(`${workspacePath(root, 'system')}.tar.gz`)).toBe(false)
  })

  it('uses the filesystem alias behavior for missing storage paths', async () => {
    const target = path.join(root, 'caf\u00e9.restoring')
    await mkdir(target)
    const caseAlias = existsSync(path.join(root, 'caf\u00e9.RESTORING'))
    const unicodeAlias = existsSync(path.join(root, 'cafe\u0301.restoring'))
    await rm(target, { recursive: true })
    const release = agentWorkspaceStorageService.reserveWorkspaceStorage([target])!
    try {
      const registration = registerWorkspace(path.join(root, 'caf\u00e9.RESTORING', 'project'))
      if (caseAlias) await expect(registration).rejects.toThrow()
      else expect((await registration).path).toBe(path.join(root, 'caf\u00e9.RESTORING', 'project'))
      const unicode = registerWorkspace(path.join(root, 'cafe\u0301.restoring', 'project'))
      if (unicodeAlias) await expect(unicode).rejects.toThrow()
      else expect((await unicode).path).toBe(path.join(root, 'cafe\u0301.restoring', 'project'))
      expect((await registerWorkspace(path.join(root, 'unrelated'))).path).toBe(path.join(root, 'unrelated'))
    } finally {
      release()
    }
  })

  it('rejects restore while storage is reserved and permits it after release', async () => {
    const parent = workspacePath(root, 'system')
    await lifecycle.archiveSessions(['system'])
    const release = agentWorkspaceStorageService.reserveWorkspaceStorage([parent], parent)!
    try {
      await expect(lifecycle.restoreSession('system')).rejects.toThrow('cannot safely restore')
      expect(existsSync(parent)).toBe(false)
      expect(
        dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'system')).get()?.deletedAt
      ).not.toBeNull()
    } finally {
      release()
    }
    await lifecycle.restoreSession('system')
    expect(await readFile(path.join(parent, 'output.txt'), 'utf8')).toBe('system output')
    expect(
      dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'system')).get()?.deletedAt
    ).toBeNull()
  })
  it.each([false, true])(
    'archives agent conversations while preserving a background session (busy=%s)',
    async (busy) => {
      dbh.db.update(agentSessionTable).set({ type: 'background' }).where(eq(agentSessionTable.id, 'user')).run()
      mocks.busyForArchive.mockImplementation((sessionId: string) => busy && sessionId === 'user')

      const result = await lifecycle.archiveAgentSessions('agent')

      expect(result.deletedIds).toEqual(['system'])
      expect(
        dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'system')).get()?.deletedAt
      ).toEqual(expect.any(Number))
      expect(
        dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'user')).get()?.deletedAt
      ).toBeNull()
      expect(await readFile(path.join(workspacePath(root, 'user'), 'output.txt'), 'utf8')).toBe('user output')
    }
  )

  it('archives background sessions in the agent-delete cascade', async () => {
    dbh.db.update(agentSessionTable).set({ type: 'background' }).where(eq(agentSessionTable.id, 'user')).run()

    await lifecycle.archiveAgent('agent', { archiveSessions: true })

    for (const id of ['system', 'user']) {
      expect(dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, id)).get()?.deletedAt).toEqual(
        expect.any(Number)
      )
    }
  })

  it('archives only system files and restores them before making the session active', async () => {
    await lifecycle.archiveSessions(['system', 'user'])
    expect(existsSync(workspacePath(root, 'system'))).toBe(false)
    expect(await readFile(path.join(workspacePath(root, 'user'), 'output.txt'), 'utf8')).toBe('user output')
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(2)
    await lifecycle.restoreSession('system')
    expect(await readFile(path.join(workspacePath(root, 'system'), 'output.txt'), 'utf8')).toBe('system output')
    expect(
      dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'system')).get()?.deletedAt
    ).toBeNull()
  })

  it.each(['purge', 'retention'] as const)(
    'removes archived system files on %s without removing user files',
    async (mode) => {
      await lifecycle.archiveSessions(['system', 'user'])
      if (mode === 'purge') await lifecycle.purgeSessions(['system', 'user'])
      else await lifecycle.purgeExpiredSessions(Number.MAX_SAFE_INTEGER, 10)
      expect(existsSync(`${workspacePath(root, 'system')}.tar.gz`)).toBe(false)
      expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(0)
      expect(await readFile(path.join(workspacePath(root, 'user'), 'output.txt'), 'utf8')).toBe('user output')
    }
  )

  it('restores system files for sessions archived together with an agent', async () => {
    await lifecycle.archiveAgent('agent', { archiveSessions: true })
    expect(existsSync(workspacePath(root, 'system'))).toBe(false)
    await lifecycle.restoreAgent('agent')
    expect(await readFile(path.join(workspacePath(root, 'system'), 'output.txt'), 'utf8')).toBe('system output')
    expect(
      dbh.db
        .select()
        .from(agentSessionTable)
        .all()
        .every((session) => session.deletedAt === null)
    ).toBe(true)
  })

  it('rejects archive while background work still owns the workspace', async () => {
    mocks.busyForArchive.mockReturnValue(true)
    await expect(lifecycle.archiveSessions(['system'])).rejects.toThrow('unsettled work')
    expect(
      dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'system')).get()?.deletedAt
    ).toBeNull()
    expect(await readFile(path.join(workspacePath(root, 'system'), 'output.txt'), 'utf8')).toBe('system output')
    expect(existsSync(`${workspacePath(root, 'system')}.tar.gz`)).toBe(false)
  })

  it('keeps the directory if runtime shutdown fails', async () => {
    mocks.closeSession.mockRejectedValueOnce(new Error('runtime still holds files'))
    await lifecycle.archiveSessions(['system'])
    expect(await readFile(path.join(workspacePath(root, 'system'), 'output.txt'), 'utf8')).toBe('system output')
    expect(existsSync(`${workspacePath(root, 'system')}.tar.gz`)).toBe(false)
  })

  it('retains files across sweep retries when permissive close resolves but strict shutdown fails', async () => {
    mocks.closeSessionForArchive.mockRejectedValue(new Error('native shutdown unconfirmed'))
    await lifecycle.archiveSessions(['system'])
    await lifecycle.sweepOrphans()
    expect(await readFile(path.join(workspacePath(root, 'system'), 'output.txt'), 'utf8')).toBe('system output')
    expect(existsSync(`${workspacePath(root, 'system')}.tar.gz`)).toBe(false)
    mocks.closeSessionForArchive.mockResolvedValue(undefined)
    await lifecycle.sweepOrphans()
    expect(existsSync(workspacePath(root, 'system'))).toBe(false)
    await lifecycle.restoreSession('system')
    expect(await readFile(path.join(workspacePath(root, 'system'), 'output.txt'), 'utf8')).toBe('system output')
  })
  it('keeps a session archived when its workspace cannot be restored', async () => {
    await lifecycle.archiveSessions(['system'])
    await writeFile(`${workspacePath(root, 'system')}.tar.gz`, 'corrupt')
    await expect(lifecycle.restoreSession('system')).rejects.toThrow()
    expect(
      dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'system')).get()?.deletedAt
    ).not.toBeNull()
  })

  it.each(['file', 'directory'] as const)(
    'keeps the session archived and its backup intact on a conflicting %s',
    async (type) => {
      const parent = workspacePath(root, 'system')
      await lifecycle.archiveSessions(['system'])
      const archive = await readFile(`${parent}.tar.gz`)
      if (type === 'file') await writeFile(parent, 'unrelated')
      else {
        await mkdir(parent)
        await writeFile(path.join(parent, 'keep.txt'), 'unrelated')
      }
      await expect(lifecycle.restoreSession('system')).rejects.toThrow()
      await lifecycle.sweepOrphans()
      expect(await readFile(`${parent}.tar.gz`)).toEqual(archive)
      expect(await readFile(type === 'file' ? parent : path.join(parent, 'keep.txt'), 'utf8')).toBe('unrelated')
      expect(
        dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'system')).get()?.deletedAt
      ).not.toBeNull()
      await rename(parent, `${parent}.kept`)
      await lifecycle.restoreSession('system')
      expect(await readFile(path.join(parent, 'output.txt'), 'utf8')).toBe('system output')
    }
  )

  it('retains the archive after DB activation fails and resumes on retry', async () => {
    const parent = workspacePath(root, 'system')
    await lifecycle.archiveSessions(['system'])
    const archive = await readFile(`${parent}.tar.gz`)
    const fail = vi.spyOn(agentSessionService, 'restore').mockImplementationOnce(() => {
      throw new Error('DB commit failed')
    })
    await expect(lifecycle.restoreSession('system')).rejects.toThrow('DB commit failed')
    expect(await readFile(`${parent}.tar.gz`)).toEqual(archive)
    expect(await readFile(path.join(parent, 'output.txt'), 'utf8')).toBe('system output')
    expect(
      dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'system')).get()?.deletedAt
    ).not.toBeNull()
    fail.mockRestore()
    await lifecycle.restoreSession('system')
    expect(existsSync(`${parent}.tar.gz`)).toBe(false)
    expect(
      dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'system')).get()?.deletedAt
    ).toBeNull()
  })

  it.each(['archive', 'pending'] as const)(
    'sweep preserves %s restore intent after interruption without activating the session',
    async (source) => {
      const parent = workspacePath(root, 'system')
      if (source === 'pending')
        vi.spyOn(workspaceArchive, 'packWorkspaceDirectory').mockRejectedValueOnce(new Error('disk full'))
      await lifecycle.archiveSessions(['system'])
      const write = workspaceArchive.writeWorkspaceStorageRecord
      const interruption = vi
        .spyOn(workspaceArchive, 'writeWorkspaceStorageRecord')
        .mockImplementation(async (target, record) => {
          await write(target, record)
          if (record.operation === 'restore' && record.phase === 'prepared') throw new Error('process interrupted')
        })
      await expect(lifecycle.restoreSession('system')).rejects.toThrow('process interrupted')
      interruption.mockRestore()
      await lifecycle.sweepOrphans()
      await lifecycle.sweepOrphans()
      expect(
        dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'system')).get()?.deletedAt
      ).not.toBeNull()
      expect(JSON.parse(await readFile(`${parent}.storage.json`, 'utf8')).operation).toBe('restore')
      expect(await readFile(path.join(parent, 'output.txt'), 'utf8')).toBe('system output')
      await lifecycle.restoreSession('system')
      expect(
        dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'system')).get()?.deletedAt
      ).toBeNull()
      expect(existsSync(`${parent}.storage.json`)).toBe(false)
    }
  )

  it('retries failed cleanup after activation through the orphan sweep', async () => {
    const parent = workspacePath(root, 'system')
    await lifecycle.archiveSessions(['system'])
    vi.spyOn(workspaceArchive, 'removeWorkspaceArtifact').mockRejectedValueOnce(new Error('cleanup interrupted'))
    await lifecycle.restoreSession('system')
    expect(existsSync(`${parent}.tar.gz`)).toBe(true)
    expect(
      dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'system')).get()?.deletedAt
    ).toBeNull()
    await lifecycle.sweepOrphans()
    expect(existsSync(`${parent}.tar.gz`)).toBe(false)
    expect(existsSync(`${parent}.storage.json`)).toBe(false)
    expect(await readFile(path.join(parent, 'output.txt'), 'utf8')).toBe('system output')
  })

  it('keeps registration blocked through DB activation and final cleanup', async () => {
    const parent = workspacePath(root, 'system')
    await lifecycle.archiveSessions(['system'])
    const entered = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    const finalize = workspaceArchive.removeWorkspaceArtifact
    vi.spyOn(workspaceArchive, 'removeWorkspaceArtifact').mockImplementationOnce(async (root, workspace, identity) => {
      entered.resolve()
      await resume.promise
      await finalize(root, workspace, identity)
    })
    const restoring = lifecycle.restoreSession('system')
    await entered.promise
    try {
      expect(
        dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'system')).get()?.deletedAt
      ).toBeNull()
      expect(existsSync(`${parent}.tar.gz`)).toBe(true)
      await expect(registerWorkspace(`${parent}.restoring`)).rejects.toThrow()
      await expect(registerWorkspace(`${parent}.storage.json`)).rejects.toThrow()
    } finally {
      resume.resolve()
      await restoring
    }
    expect(existsSync(`${parent}.tar.gz`)).toBe(false)
    expect((await registerWorkspace(path.join(parent, 'project'))).path).toBe(path.join(parent, 'project'))
  })

  it('prepares all Agent workspaces before activation and retries a partial preparation', async () => {
    const second = workspacePath(root, 'system2')
    await mkdir(second)
    await writeFile(path.join(second, 'output.txt'), 'second output')
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'system2', name: 'system2', type: 'system', path: second, orderKey: 'a2' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'system2', agentId: 'agent', workspaceId: 'system2', name: 'system2', orderKey: 'a2' })
      .run()
    await lifecycle.archiveAgent('agent', { archiveSessions: true })
    const archive = await readFile(`${second}.tar.gz`)
    await writeFile(`${second}.tar.gz`, 'corrupt')
    await expect(lifecycle.restoreAgent('agent')).rejects.toThrow()
    expect(dbh.db.select().from(agentTable).where(eq(agentTable.id, 'agent')).get()?.deletedAt).not.toBeNull()
    expect(
      dbh.db
        .select()
        .from(agentSessionTable)
        .all()
        .every((session) => session.deletedAt !== null)
    ).toBe(true)
    expect(await readFile(path.join(workspacePath(root, 'system'), 'output.txt'), 'utf8')).toBe('system output')
    expect(existsSync(`${workspacePath(root, 'system')}.tar.gz`)).toBe(true)
    await writeFile(`${second}.tar.gz`, archive)
    await lifecycle.restoreAgent('agent')
    expect(
      dbh.db
        .select()
        .from(agentSessionTable)
        .all()
        .every((session) => session.deletedAt === null)
    ).toBe(true)
    expect(await readFile(path.join(second, 'output.txt'), 'utf8')).toBe('second output')
  })

  it.runIf(process.platform === 'linux')(
    'permits distinct case-sensitive workspaces throughout archive and restore',
    async () => {
      const distinct = path.join(root, '2026-10-12', 'System', 'project')
      await mkdir(distinct, { recursive: true })
      await writeFile(path.join(distinct, 'keep.txt'), 'distinct user directory')
      await registerWorkspace(distinct)
      await lifecycle.archiveSessions(['system'])
      expect(existsSync(`${workspacePath(root, 'system')}.tar.gz`)).toBe(true)
      await lifecycle.restoreSession('system')
      expect(await readFile(path.join(workspacePath(root, 'system'), 'output.txt'), 'utf8')).toBe('system output')
      expect(await readFile(path.join(distinct, 'keep.txt'), 'utf8')).toBe('distinct user directory')
    }
  )

  it('preserves claimed archives in the orphan sweep and reclaims them after their rows disappear', async () => {
    await lifecycle.archiveSessions(['system'])
    const archive = `${workspacePath(root, 'system')}.tar.gz`
    const pending = `${workspacePath(root, 'system')}.restoring`
    await mkdir(pending)
    const stale = new Date(Date.now() - 3_600_000)
    await utimes(archive, stale, stale)
    await utimes(pending, stale, stale)
    await sweepAgentOrphans()
    expect(existsSync(archive)).toBe(true)
    expect(existsSync(pending)).toBe(true)
    dbh.db.delete(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, 'system')).run()
    await sweepAgentOrphans()
    expect(existsSync(archive)).toBe(false)
    expect(existsSync(pending)).toBe(false)
  })

  it('does not restore a workspace belonging to an independently archived session with its agent', async () => {
    await lifecycle.archiveSessions(['system'])
    dbh.db.update(agentSessionTable).set({ deletedAt: 1 }).where(eq(agentSessionTable.id, 'system')).run()
    await lifecycle.archiveAgent('agent', { archiveSessions: true })
    await lifecycle.restoreAgent('agent')
    expect(existsSync(workspacePath(root, 'system'))).toBe(false)
    expect(existsSync(`${workspacePath(root, 'system')}.tar.gz`)).toBe(true)
    expect(dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'system')).get()?.deletedAt).toBe(1)
  })
})
