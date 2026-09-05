import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { PiRuntimeDriver } from '@main/ai/runtime/pi/PiRuntimeDriver'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import type { AgentSessionRuntimeDriver } from '@main/ai/runtime/types'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const { restoreJournalMock } = vi.hoisted(() => ({ restoreJournalMock: { hasPendingRestore: vi.fn(() => false) } }))
vi.mock('@data/db/restore/restoreJournal', () => restoreJournalMock)

const { sweepAgentOrphans } = await import('../agentOrphanSweep')

/** Older than the sweep's 5-minute freshness gate. */
const STALE_SECONDS = (Date.now() - 60 * 60 * 1000) / 1000

/** Backdate a whole tree past the gate — `newestMtimeMs` walks children, so each one has to move. */
function makeStale(target: string) {
  if (statSync(target).isDirectory()) {
    for (const child of readdirSync(target)) makeStale(path.join(target, child))
  }
  utimesSync(target, STALE_SECONDS, STALE_SECONDS)
}

const AGENT_LIVE = '11111111-1111-4111-8111-111111111111'
const AGENT_TRASHED = '22222222-2222-4222-8222-222222222222'
const AGENT_GONE = '33333333-3333-4333-8333-333333333333'

describe('sweepAgentOrphans', () => {
  const dbh = setupTestDatabase()
  let root: string
  let workspacesRoot: string

  beforeEach(() => {
    restoreJournalMock.hasPendingRestore.mockReturnValue(false)
    // Mirrors pathRegistry: system workspaces live *inside* the agents data root.
    root = mkdtempSync(path.join(tmpdir(), 'cs-agent-sweep-'))
    workspacesRoot = path.join(root, 'system')
    ;(application.getPath as Mock).mockImplementation((key: string) => {
      if (key === 'feature.agents.data') return root
      if (key === 'feature.agents.system_workspaces') return workspacesRoot
      return `/mock/${key}`
    })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    vi.mocked(application.getPath as Mock).mockReset()
  })

  async function seedAgent(id: string, deletedAt: number | null = null) {
    await dbh.db.insert(agentTable).values({
      id,
      type: 'claude-code',
      name: id,
      instructions: 'i',
      orderKey: 'a0',
      deletedAt
    })
  }

  async function seedSessionWithToken(sessionId: string, resumeToken: string) {
    await dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: `ws-${sessionId}`, name: 'ws', path: `/tmp/${sessionId}`, orderKey: 'a0' })
    await dbh.db
      .insert(agentSessionTable)
      .values({ id: sessionId, agentId: null, name: sessionId, workspaceId: `ws-${sessionId}`, orderKey: 'a0' })
    await dbh.db.insert(agentSessionMessageTable).values({
      id: `msg-${sessionId}`,
      sessionId,
      role: 'user',
      data: { parts: [{ type: 'text', text: 'hi' }] },
      searchableText: 'hi',
      status: 'success',
      runtimeResumeToken: resumeToken
    })
  }

  async function seedWorkspace(id: string, workspacePath: string) {
    await dbh.db.insert(agentWorkspaceTable).values({ id, name: id, path: workspacePath, orderKey: 'a0' })
  }

  it('never touches the runtime roots that sit beside the per-agent dirs', async () => {
    for (const name of ['.claude', '.pi', '.dsh', 'system']) {
      mkdirSync(path.join(root, name), { recursive: true })
      writeFileSync(path.join(root, name, 'keep.json'), '{}')
    }

    const { removed } = await sweepAgentOrphans()

    expect(removed).toEqual([])
    for (const name of ['.claude', '.pi', '.dsh', 'system']) {
      expect(existsSync(path.join(root, name, 'keep.json'))).toBe(true)
    }
  })

  it('keeps agent-id dirs (live and trashed) and removes ones whose agent row is gone', async () => {
    await seedAgent(AGENT_LIVE)
    await seedAgent(AGENT_TRASHED, Date.now())
    mkdirSync(path.join(root, AGENT_LIVE))
    mkdirSync(path.join(root, AGENT_TRASHED))
    const orphan = path.join(root, AGENT_GONE)
    mkdirSync(orphan)
    writeFileSync(path.join(orphan, 'residue.txt'), 'x')
    makeStale(orphan)

    const { removed } = await sweepAgentOrphans()

    expect(removed).toEqual([orphan])
    expect(existsSync(orphan)).toBe(false)
    expect(existsSync(path.join(root, AGENT_LIVE))).toBe(true)
    expect(existsSync(path.join(root, AGENT_TRASHED))).toBe(true)
  })

  it('keeps a warm agent dir — its agent row may not have committed when the keep-set was read', async () => {
    const racing = path.join(root, AGENT_GONE)
    mkdirSync(racing)
    writeFileSync(path.join(racing, 'identity.json'), '{}')

    const { removed } = await sweepAgentOrphans()

    expect(removed).toEqual([])
    expect(existsSync(racing)).toBe(true)
  })

  it('keeps a warm session workspace dir whose agent_workspace row has not committed yet', async () => {
    const racing = path.join(workspacesRoot, '2026-08-19', 'session-being-created')
    mkdirSync(racing, { recursive: true })

    const { removed } = await sweepAgentOrphans()

    expect(removed).toEqual([])
    expect(existsSync(racing)).toBe(true)
  })

  it('removes session workspace dirs whose agent_workspace row was purged, and the emptied date dir', async () => {
    const dateDir = path.join(workspacesRoot, '2026-08-19')
    const claimed = path.join(dateDir, 'session-claimed')
    const orphan = path.join(dateDir, 'session-purged')
    mkdirSync(claimed, { recursive: true })
    mkdirSync(orphan, { recursive: true })
    writeFileSync(path.join(orphan, 'agent-output.md'), 'x')
    makeStale(claimed)
    makeStale(orphan)
    await seedWorkspace('ws-1', claimed)

    const { removed } = await sweepAgentOrphans()

    expect(removed).toEqual([orphan])
    expect(existsSync(claimed)).toBe(true)

    // Purge the workspace row: the whole date dir goes on the next run.
    await dbh.db.delete(agentWorkspaceTable)
    const second = await sweepAgentOrphans()
    expect(second.removed).toEqual([claimed, dateDir])
    expect(existsSync(dateDir)).toBe(false)
  })

  it('stands aside while a restore is staged — its dirs are on disk before the DB claims them', async () => {
    restoreJournalMock.hasPendingRestore.mockReturnValue(true)
    const orphan = path.join(root, AGENT_GONE)
    mkdirSync(orphan)
    writeFileSync(path.join(orphan, 'residue.txt'), 'x')
    makeStale(orphan)

    const { removed } = await sweepAgentOrphans()

    expect(removed).toEqual([])
    expect(existsSync(orphan)).toBe(true)
  })

  it('leaves plain files untouched at either root', async () => {
    const stray = path.join(root, 'stray.txt')
    const strayWorkspace = path.join(workspacesRoot, '2026-08-19', 'notes.txt')
    mkdirSync(path.dirname(strayWorkspace), { recursive: true })
    writeFileSync(stray, 'keep me')
    writeFileSync(strayWorkspace, 'keep me')

    const { removed } = await sweepAgentOrphans()

    expect(removed).toEqual([])
    expect(existsSync(stray)).toBe(true)
    expect(existsSync(strayWorkspace)).toBe(true)
  })

  it('returns without touching anything when the roots do not exist', async () => {
    ;(application.getPath as Mock).mockImplementation((key: string) => path.join(root, `missing-${key}`))

    await expect(sweepAgentOrphans()).resolves.toEqual({ removed: [], failedDrivers: [] })
  })

  describe('runtime session reclaim', () => {
    function registerDriver(type: string, reclaim: AgentSessionRuntimeDriver['reclaimOrphanSessions']) {
      runtimeDriverRegistry.register({
        type,
        capabilities: ['agent-session'],
        validateSession: vi.fn(),
        listAvailableTools: vi.fn(),
        connect: vi.fn(),
        reclaimOrphanSessions: reclaim
      } as unknown as AgentSessionRuntimeDriver)
    }

    afterEach(() => runtimeDriverRegistry.clearForTest())

    it('hands each driver the resume tokens of surviving sessions', async () => {
      await seedSessionWithToken('session-live', 'token-live')
      let seen: ReadonlySet<string> | undefined
      registerDriver('pi', async (tokens) => {
        seen = tokens
        return { removed: ['/tmp/reclaimed.jsonl'] }
      })

      const { removed } = await sweepAgentOrphans()

      expect([...(seen ?? [])]).toEqual(['token-live'])
      expect(removed).toContain('/tmp/reclaimed.jsonl')
    })

    it('keeps a trashed session’s runtime state and reclaims it once the session row is purged', async () => {
      const piSessions = path.join(root, 'pi-sessions')
      mkdirSync(piSessions, { recursive: true })
      const transcript = path.join(piSessions, '2026-08-19T00-00-00-000Z_token-live.jsonl')
      writeFileSync(transcript, 'x')
      utimesSync(transcript, STALE_SECONDS, STALE_SECONDS)
      ;(application.getPath as Mock).mockImplementation((key: string) => {
        if (key === 'feature.agents.data') return root
        if (key === 'feature.agents.system_workspaces') return workspacesRoot
        if (key === 'feature.agents.pi.sessions') return piSessions
        return path.join(root, `unused-${key}`)
      })
      runtimeDriverRegistry.register(new PiRuntimeDriver())

      // Trashed (soft-deleted) session: its message rows — and so its token — survive.
      await seedSessionWithToken('session-trashed', 'token-live')
      await dbh.db
        .update(agentSessionTable)
        .set({ deletedAt: Date.now() })
        .where(eq(agentSessionTable.id, 'session-trashed'))

      await sweepAgentOrphans()
      expect(existsSync(transcript)).toBe(true)

      // Purge drops the session row; the FK cascade takes its token with it.
      await dbh.db.delete(agentSessionTable).where(eq(agentSessionTable.id, 'session-trashed'))
      const { removed } = await sweepAgentOrphans()

      expect(removed).toContain(transcript)
      expect(existsSync(transcript)).toBe(false)
    })

    it('isolates a failing runtime so the others still reclaim', async () => {
      registerDriver('dsh', async () => {
        throw new Error('dsh reclaim exploded')
      })
      registerDriver('pi', async () => ({ removed: ['/tmp/pi.jsonl'] }))

      const { removed, failedDrivers } = await sweepAgentOrphans()

      expect(failedDrivers).toEqual(['dsh'])
      expect(removed).toContain('/tmp/pi.jsonl')
    })
  })
})
