import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const { sweepOrphanAgentDirs } = await import('../agentDirOrphanSweep')

describe('sweepOrphanAgentDirs', () => {
  const dbh = setupTestDatabase()
  let root: string

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'cs-agent-sweep-'))
    ;(application.getPath as Mock).mockImplementation((key: string) =>
      key === 'feature.agents.workspaces' ? root : `/mock/${key}`
    )
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

  it('keeps workspace-row dirs and agent-id dirs (live and archived), removes unknown dirs', async () => {
    // (a) dir claimed by an agent_workspace.path row (today's session workspaces)
    const wsDir = path.join(root, 'session-workspace')
    mkdirSync(wsDir)
    await dbh.db.insert(agentWorkspaceTable).values({ id: 'ws-1', name: 'ws', path: wsDir, orderKey: 'a0' })

    // (b) dirs named by an agent id, with NO workspace row — live AND archived
    await seedAgent('agent-live')
    await seedAgent('agent-archived', Date.now())
    mkdirSync(path.join(root, 'agent-live'))
    mkdirSync(path.join(root, 'agent-archived'))

    // orphan: on disk, claimed by neither source
    const orphan = path.join(root, 'no-longer-an-agent')
    mkdirSync(orphan)
    writeFileSync(path.join(orphan, 'residue.txt'), 'x')

    const { removed } = await sweepOrphanAgentDirs()

    expect(removed).toEqual([orphan])
    expect(existsSync(orphan)).toBe(false)
    expect(existsSync(wsDir)).toBe(true)
    expect(existsSync(path.join(root, 'agent-live'))).toBe(true)
    expect(existsSync(path.join(root, 'agent-archived'))).toBe(true)
  })

  it('leaves plain files at the root untouched', async () => {
    const stray = path.join(root, 'stray.txt')
    writeFileSync(stray, 'keep me')

    const { removed } = await sweepOrphanAgentDirs()

    expect(removed).toEqual([])
    expect(existsSync(stray)).toBe(true)
  })

  it('never recurses into kept dirs — nested unknown dirs survive', async () => {
    await seedAgent('agent-live')
    const nested = path.join(root, 'agent-live', 'some-unknown-subdir')
    mkdirSync(nested, { recursive: true })

    const { removed } = await sweepOrphanAgentDirs()

    expect(removed).toEqual([])
    expect(existsSync(nested)).toBe(true)
  })

  it('returns without touching anything when the root does not exist', async () => {
    ;(application.getPath as Mock).mockImplementation(() => path.join(root, 'does-not-exist'))

    await expect(sweepOrphanAgentDirs()).resolves.toEqual({ removed: [] })
  })
})
