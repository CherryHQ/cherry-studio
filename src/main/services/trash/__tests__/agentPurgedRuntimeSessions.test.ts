import '@data/services/MessageService'
import '@data/services/AgentSessionMessageService'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { AgentLifecycleService } from '@main/ai/agents/AgentLifecycleService'
import { registerRuntimeDrivers } from '@main/ai/runtime/registerDrivers'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import { BaseService } from '@main/core/lifecycle/BaseService'

const { claimedTokens } = vi.hoisted(() => ({ claimedTokens: new Set<string>() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AiStreamManager: {
      isWriteQuiesced: false,
      withDispatchLock: (_id: string, operation: () => unknown) => operation(),
      hasUnsettledTopicWork: () => false,
      abortAndDrain: async () => undefined,
      pauseRuntimeTurn: vi.fn()
    },
    AgentSessionRuntimeService: {
      isSessionBusy: () => false,
      isSessionBusyForArchive: () => false,
      listClaimedResumeTokens: () => new Set(claimedTokens),
      closeSession: async () => undefined,
      cancelSessionForks: async () => undefined,
      recoverSessionForks: async () => undefined
    },
    AgentSessionDeliveryService: {
      pause: () => ({ dispose() {} }),
      drainSessionQueues: async () => undefined,
      kick: vi.fn()
    },
    ChannelManager: { reconcileAgent: vi.fn() }
  } as Parameters<typeof mockApplicationFactory>[0])
})

describe('permanent Agent Session transcript reclaim', () => {
  const dbh = setupTestDatabase()
  let root: string
  let projectsRoot: string
  let service: AgentLifecycleService

  beforeEach(() => {
    BaseService.resetInstances()
    claimedTokens.clear()
    runtimeDriverRegistry.clearForTest()
    registerRuntimeDrivers()
    root = mkdtempSync(path.join(tmpdir(), 'cs-agent-purge-'))
    projectsRoot = path.join(root, '.claude', 'projects')
    ;(application.getPath as Mock).mockImplementation((key: string) => {
      if (key === 'feature.agents.claude.projects') return projectsRoot
      return path.join(root, key)
    })
    service = new AgentLifecycleService()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', type: 'user', name: 'Workspace', path: path.join(root, 'workspace'), orderKey: 'a0' })
      .run()
  })

  afterEach(() => {
    runtimeDriverRegistry.clearForTest()
    rmSync(root, { recursive: true, force: true })
    vi.mocked(application.getPath as Mock).mockReset()
    BaseService.resetInstances()
  })

  function seedSession(id: string, token: string, options: { archived?: boolean; agentId?: string } = {}) {
    dbh.db
      .insert(agentSessionTable)
      .values({
        id,
        agentId: options.agentId ?? null,
        workspaceId: 'workspace',
        name: id,
        orderKey: id,
        deletedAt: options.archived ? Date.now() - 1000 : null
      })
      .run()
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        id: `msg-${id}`,
        sessionId: id,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'hi' }] },
        searchableText: 'hi',
        status: 'success',
        runtimeResumeToken: token
      })
      .run()
  }

  function seedTranscript(token: string) {
    const projectDir = path.join(projectsRoot, '-tmp-work')
    const transcript = path.join(projectDir, `${token}.jsonl`)
    const subagent = path.join(projectDir, token, 'agent-1.jsonl')
    mkdirSync(path.dirname(subagent), { recursive: true })
    writeFileSync(transcript, 'fresh transcript')
    writeFileSync(subagent, 'fresh subagent transcript')
    const now = new Date()
    utimesSync(transcript, now, now)
    utimesSync(subagent, now, now)
    return { projectDir, transcript, subagent }
  }

  it('reclaims a freshly archived session immediately after permanent deletion, leaving another session intact', async () => {
    seedSession('purged', 'purged-token')
    seedSession('active', 'active-token')
    const purged = seedTranscript('purged-token')
    const active = seedTranscript('active-token')

    await service.archiveSessions(['purged'])
    const result = await service.purgeSessions(['purged', 'active'])

    expect(result.deletedIds).toEqual(['purged'])
    expect(
      dbh.db
        .select()
        .from(agentSessionTable)
        .all()
        .map((row) => row.id)
    ).toEqual(['active'])
    expect(existsSync(purged.transcript)).toBe(false)
    expect(existsSync(purged.subagent)).toBe(false)
    expect(existsSync(active.transcript)).toBe(true)
    expect(existsSync(active.subagent)).toBe(true)
    expect(existsSync(purged.projectDir)).toBe(true)
  })

  it('keeps both transcript artifacts when a session is only archived', async () => {
    seedSession('archived', 'archive-token')
    const files = seedTranscript('archive-token')

    await service.archiveSessions(['archived'])

    expect(existsSync(files.transcript)).toBe(true)
    expect(existsSync(files.subagent)).toBe(true)
  })

  it('preserves a purged session transcript while its token is claimed by a live runtime', async () => {
    seedSession('purged', 'claimed-token', { archived: true })
    const files = seedTranscript('claimed-token')
    claimedTokens.add('claimed-token')

    const result = await service.purgeSessions(['purged'])

    expect(result.deletedIds).toEqual(['purged'])
    expect(existsSync(files.transcript)).toBe(true)
    expect(existsSync(files.subagent)).toBe(true)
  })

  it('reclaims a freshly archived session during expired trash purge', async () => {
    seedSession('expired', 'expired-token', { archived: true })
    const files = seedTranscript('expired-token')

    const result = await service.purgeExpiredSessions(Number.MAX_SAFE_INTEGER, 10)

    expect(result.purgedIds).toEqual(['expired'])
    expect(existsSync(files.transcript)).toBe(false)
    expect(existsSync(files.subagent)).toBe(false)
    expect(existsSync(files.projectDir)).toBe(false)
  })

  it('reclaims a fresh transcript when deleting an active session permanently', async () => {
    seedSession('active', 'active-token')
    const files = seedTranscript('active-token')

    const result = await service.deleteActiveSessionsPermanently(['active'])

    expect(result.deletedIds).toEqual(['active'])
    expect(existsSync(files.transcript)).toBe(false)
    expect(existsSync(files.subagent)).toBe(false)
  })

  it('reclaims a fresh transcript when permanently deleting an active agent and its sessions', async () => {
    dbh.db
      .insert(agentTable)
      .values({ id: 'agent', type: 'claude-code', name: 'Agent', instructions: '', orderKey: 'a0' })
      .run()
    seedSession('agent-session', 'agent-token', { agentId: 'agent' })
    const files = seedTranscript('agent-token')

    const result = await service.deleteActiveAgentPermanently('agent', true)

    expect(result.deletedSessionIds).toEqual(['agent-session'])
    expect(existsSync(files.transcript)).toBe(false)
    expect(existsSync(files.subagent)).toBe(false)
  })
})
