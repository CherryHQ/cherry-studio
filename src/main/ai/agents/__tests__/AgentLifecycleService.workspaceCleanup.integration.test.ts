import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { BaseService } from '@main/core/lifecycle/BaseService'

import { AgentLifecycleService } from '../AgentLifecycleService'

const mocks = vi.hoisted(() => ({ closeSession: vi.fn() }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AiStreamManager: {
      isWriteQuiesced: false,
      withDispatchLock: (_id: string, operation: () => unknown) => operation(),
      hasUnsettledTopicWork: () => false,
      abortAndDrain: vi.fn(),
      pauseRuntimeTurn: vi.fn()
    },
    AgentSessionRuntimeService: {
      isSessionBusy: () => false,
      closeSession: mocks.closeSession,
      cancelSessionForks: vi.fn().mockResolvedValue(undefined),
      recoverSessionForks: vi.fn().mockResolvedValue(undefined)
    },
    AgentSessionDeliveryService: { drainSessionQueues: vi.fn(), kick: vi.fn() },
    ChannelManager: { reconcileAgent: vi.fn() }
  } as Parameters<typeof mockApplicationFactory>[0])
})

describe('Agent Lifecycle workspace cleanup', () => {
  const dbh = setupTestDatabase()
  let root: string

  beforeEach(() => {
    BaseService.resetInstances()
    mocks.closeSession.mockReset().mockResolvedValue(undefined)
    root = mkdtempSync(path.join(tmpdir(), 'cs-workspace-cleanup-'))
    vi.mocked(application.getPath).mockImplementation((key) => {
      if (key === 'feature.agents.system_workspaces') return path.join(root, 'system')
      return path.join(root, key)
    })
    dbh.db
      .insert(agentTable)
      .values({ id: 'agent', type: 'claude-code', name: 'Agent', instructions: '', orderKey: 'a0' })
      .run()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    vi.mocked(application.getPath).mockReset()
    BaseService.resetInstances()
  })

  function createSystemSession() {
    const session = agentSessionService.create({ agentId: 'agent', name: 'System', workspace: { type: 'system' } })
    mkdirSync(session.workspace.path, { recursive: true })
    writeFileSync(path.join(session.workspace.path, 'keep.txt'), 'Workspace contents')
    return session
  }

  it.each(['recycle-bin', 'active-session', 'agent'] as const)(
    'preserves additional roots while deleting unclaimed system directories through %s',
    async (source) => {
      const shared = createSystemSession()
      const unclaimed = createSystemSession()
      const workspace = agentWorkspaceService.findOrCreateByPath(path.join(root, 'user'))
      agentWorkspaceService.update(workspace.id, { additionalDirectories: [shared.workspace.path] })
      const lifecycle = new AgentLifecycleService()
      const sessionIds = [shared.id, unclaimed.id]

      if (source === 'recycle-bin') {
        await lifecycle.archiveSessions(sessionIds)
        expect(readFileSync(path.join(shared.workspace.path, 'keep.txt'), 'utf8')).toBe('Workspace contents')
        expect(existsSync(unclaimed.workspace.path)).toBe(true)
        await lifecycle.purgeSessions(sessionIds)
      } else if (source === 'active-session') {
        await lifecycle.deleteActiveSessionsPermanently(sessionIds)
      } else {
        await lifecycle.deleteActiveAgentPermanently('agent', true)
      }

      expect(dbh.db.select().from(agentSessionTable).all()).toEqual([])
      expect(
        dbh.db
          .select()
          .from(agentWorkspaceTable)
          .all()
          .map((row) => row.id)
      ).toEqual([workspace.id])
      expect(agentWorkspaceService.getById(workspace.id).additionalDirectories).toEqual([shared.workspace.path])
      expect(readFileSync(path.join(shared.workspace.path, 'keep.txt'), 'utf8')).toBe('Workspace contents')
      expect(existsSync(unclaimed.workspace.path)).toBe(false)
    }
  )

  it('preserves a main root registered while the deleted session runtime closes', async () => {
    const session = createSystemSession()
    mocks.closeSession.mockImplementationOnce(async () => {
      agentWorkspaceService.findOrCreateByPath(session.workspace.path)
    })

    await new AgentLifecycleService().deleteActiveSessionsPermanently([session.id])

    expect(dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, session.id)).get()).toBeUndefined()
    expect(agentWorkspaceService.list().map((workspace) => workspace.path)).toEqual([session.workspace.path])
    expect(readFileSync(path.join(session.workspace.path, 'keep.txt'), 'utf8')).toBe('Workspace contents')
  })
})
