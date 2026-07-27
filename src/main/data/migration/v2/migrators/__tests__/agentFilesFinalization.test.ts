import { access, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { finalizePendingAgentFiles, replacePendingAgentFilesFinalization } from '../agentFilesFinalization'
import {
  type LegacyAgentFilesCleanupPlan,
  legacyAgentWorkspacePath,
  stageLegacyAgentFiles
} from '../agentsFilesystemMigration'

const SOURCE_AGENT_ID = 'agent_legacy123'
const FINAL_AGENT_ID = '5f83c9de-f186-5d86-813f-1a19f190c68c'

describe('Agent files migration finalization', () => {
  const dbh = setupTestDatabase()
  let tempRoot = ''
  let agentsDataRoot = ''
  let legacyWorkspace = ''

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-finalization-'))
    agentsDataRoot = path.join(tempRoot, 'Data', 'Agents')
    legacyWorkspace = legacyAgentWorkspacePath(agentsDataRoot, SOURCE_AGENT_ID)
    await mkdir(legacyWorkspace, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  async function plan(entryNames: string[]): Promise<LegacyAgentFilesCleanupPlan> {
    const stagedPlan = await stageLegacyAgentFiles({
      agentsDataRoot,
      agents: [{ sourceAgentId: SOURCE_AGENT_ID, finalAgentId: FINAL_AGENT_ID }],
      sessions: []
    })
    return {
      ...stagedPlan,
      workspaces: stagedPlan.workspaces
        .map((workspace) => ({
          ...workspace,
          entries: workspace.entries.filter((entry) => entryNames.includes(entry.entryName))
        }))
        .filter((workspace) => workspace.entries.length > 0)
    }
  }

  it('replaces an earlier attempt instead of merging stale cleanup entries', async () => {
    await writeFile(path.join(legacyWorkspace, 'SOUL.md'), 'newer source')
    await writeFile(path.join(legacyWorkspace, 'USER.md'), 'copied source')

    const stagedPlan = await plan(['SOUL.md', 'USER.md'])
    replacePendingAgentFilesFinalization(dbh.db, {
      ...stagedPlan,
      workspaces: stagedPlan.workspaces.map((workspace) => ({
        ...workspace,
        entries: workspace.entries.filter((entry) => entry.entryName === 'SOUL.md')
      }))
    })
    replacePendingAgentFilesFinalization(dbh.db, {
      ...stagedPlan,
      workspaces: stagedPlan.workspaces.map((workspace) => ({
        ...workspace,
        entries: workspace.entries.filter((entry) => entry.entryName === 'USER.md')
      }))
    })
    await expect(finalizePendingAgentFiles(dbh.db, agentsDataRoot)).resolves.toBe(true)

    await expect(access(path.join(legacyWorkspace, 'SOUL.md'))).resolves.toBeUndefined()
    await expect(access(path.join(legacyWorkspace, 'USER.md'))).rejects.toThrow()
    await expect(finalizePendingAgentFiles(dbh.db, agentsDataRoot)).resolves.toBe(false)
  })

  it('keeps the durable plan after a failed attempt so a later launch can retry', async () => {
    await writeFile(path.join(legacyWorkspace, 'SOUL.md'), 'copied source')
    replacePendingAgentFilesFinalization(dbh.db, await plan(['SOUL.md']))

    await expect(finalizePendingAgentFiles(dbh.db, path.join(tempRoot, 'wrong-root'))).rejects.toThrow(/does not match/)
    await expect(access(path.join(legacyWorkspace, 'SOUL.md'))).resolves.toBeUndefined()

    await expect(finalizePendingAgentFiles(dbh.db, agentsDataRoot)).resolves.toBe(true)
    await expect(access(path.join(legacyWorkspace, 'SOUL.md'))).rejects.toThrow()
  })

  it('keeps a same-size source change even when its mtime is restored after staging', async () => {
    const sourcePath = path.join(legacyWorkspace, 'SOUL.md')
    await writeFile(sourcePath, 'copied source')
    replacePendingAgentFilesFinalization(dbh.db, await plan(['SOUL.md']))
    const stagedStat = await stat(sourcePath)

    await writeFile(sourcePath, 'newest source')
    await utimes(sourcePath, stagedStat.atime, stagedStat.mtime)
    await expect(finalizePendingAgentFiles(dbh.db, agentsDataRoot)).resolves.toBe(true)

    expect(await readFile(sourcePath, 'utf8')).toBe('newest source')
    await expect(finalizePendingAgentFiles(dbh.db, agentsDataRoot)).resolves.toBe(false)
  })

  it('keeps a source entry when its migrated destination disappeared', async () => {
    await writeFile(path.join(legacyWorkspace, 'SOUL.md'), 'copied source')
    const cleanupPlan = await plan(['SOUL.md'])
    const destinationPath = cleanupPlan.workspaces[0]?.entries[0]?.destinationPath
    expect(destinationPath).toBeDefined()
    replacePendingAgentFilesFinalization(dbh.db, cleanupPlan)

    await rm(destinationPath)
    await expect(finalizePendingAgentFiles(dbh.db, agentsDataRoot)).resolves.toBe(true)

    expect(await access(path.join(legacyWorkspace, 'SOUL.md'))).toBeUndefined()
    await expect(finalizePendingAgentFiles(dbh.db, agentsDataRoot)).resolves.toBe(false)
  })

  it('keeps a source entry when its migrated destination content changed', async () => {
    const sourcePath = path.join(legacyWorkspace, 'SOUL.md')
    await writeFile(sourcePath, 'copied source')
    const cleanupPlan = await plan(['SOUL.md'])
    const destinationPath = cleanupPlan.workspaces[0]?.entries[0]?.destinationPath
    expect(destinationPath).toBeDefined()
    replacePendingAgentFilesFinalization(dbh.db, cleanupPlan)

    const stagedStat = await stat(destinationPath)
    await writeFile(destinationPath, 'newest target')
    await utimes(destinationPath, stagedStat.atime, stagedStat.mtime)
    await expect(finalizePendingAgentFiles(dbh.db, agentsDataRoot)).resolves.toBe(true)

    expect(await readFile(sourcePath, 'utf8')).toBe('copied source')
  })

  it('falls back to content verification when metadata changed but content is identical', async () => {
    const sourcePath = path.join(legacyWorkspace, 'SOUL.md')
    await writeFile(sourcePath, 'copied source')
    const cleanupPlan = await plan(['SOUL.md'])
    const sourceEntry = cleanupPlan.workspaces[0]?.entries[0]
    expect(sourceEntry).toBeDefined()
    sourceEntry.sourceMetadataFingerprint = '0'.repeat(64)
    replacePendingAgentFilesFinalization(dbh.db, cleanupPlan)

    await expect(finalizePendingAgentFiles(dbh.db, agentsDataRoot)).resolves.toBe(true)

    await expect(access(sourcePath)).rejects.toThrow()
    await expect(finalizePendingAgentFiles(dbh.db, agentsDataRoot)).resolves.toBe(false)
  })
})
