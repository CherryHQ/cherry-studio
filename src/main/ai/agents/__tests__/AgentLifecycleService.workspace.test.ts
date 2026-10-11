import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { BaseService } from '@main/core/lifecycle/BaseService'

import { AgentLifecycleService } from '../AgentLifecycleService'
import { sweepAgentOrphans } from '../agentOrphanSweep'

const mocks = vi.hoisted(() => ({ closeSession: vi.fn().mockResolvedValue(undefined) }))

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
      closeSession: mocks.closeSession
    },
    AgentSessionDeliveryService: {
      pause: () => ({ dispose() {} }),
      drainSessionQueues: async () => {},
      kick: () => {}
    },
    ChannelManager: { reconcileAgent: () => {} }
  } as Parameters<typeof mockApplicationFactory>[0])
})

describe('Agent lifecycle workspace persistence', () => {
  const dbh = setupTestDatabase()
  let root: string
  let lifecycle: AgentLifecycleService

  beforeEach(async () => {
    BaseService.resetInstances()
    mocks.closeSession.mockResolvedValue(undefined)
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
      dbh.db.insert(agentWorkspaceTable).values({ id: type, name: type, type, path: workspace, orderKey: type }).run()
      dbh.db
        .insert(agentSessionTable)
        .values({ id: type, agentId: 'agent', workspaceId: type, name: type, orderKey: type })
        .run()
    }
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    BaseService.resetInstances()
    await rm(root, { recursive: true, force: true })
  })

  const workspacePath = (root: string, id: string) => path.join(root, '2026-10-12', id)

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

  it('keeps the directory if runtime shutdown fails', async () => {
    mocks.closeSession.mockRejectedValueOnce(new Error('runtime still holds files'))
    await lifecycle.archiveSessions(['system'])
    expect(await readFile(path.join(workspacePath(root, 'system'), 'output.txt'), 'utf8')).toBe('system output')
    expect(existsSync(`${workspacePath(root, 'system')}.tar.gz`)).toBe(false)
  })

  it('keeps a session archived when its workspace cannot be restored', async () => {
    await lifecycle.archiveSessions(['system'])
    await writeFile(`${workspacePath(root, 'system')}.tar.gz`, 'corrupt')
    await expect(lifecycle.restoreSession('system')).rejects.toThrow()
    expect(
      dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'system')).get()?.deletedAt
    ).not.toBeNull()
  })

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
