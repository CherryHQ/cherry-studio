import { mkdir, mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { appStateTable } from '@data/db/schemas/appState'
import { BaseService } from '@main/core/lifecycle'

import { planLegacyMemory } from '../legacyMemoryPlan'
import { MemoryMigrationService } from '../MemoryMigrationService'
import { MemoryService } from '../MemoryService'

describe('legacy memory activation', () => {
  const dbh = setupTestDatabase()
  const agentId = 'migration-agent'
  let fixture: string
  let root: string
  let memory: MemoryService
  let migration: MemoryMigrationService

  async function removeFixture(directory: string): Promise<void> {
    if (directory !== fixture && !directory.startsWith(`${fixture}${path.sep}`)) throw new Error('Outside fixture')
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory() && !entry.isSymbolicLink()) await removeFixture(target)
      else await unlink(target)
    }
    await rmdir(directory)
  }

  beforeEach(async () => {
    BaseService.resetInstances()
    fixture = await mkdtemp(path.join(os.tmpdir(), 'cherry-memory-migration-'))
    vi.spyOn(application, 'getPath').mockImplementation((key, name) => path.join(fixture, key, name ?? ''))
    root = path.join(fixture, 'feature.agents.data', agentId)
    await mkdir(path.join(root, 'memory'), { recursive: true })
    dbh.db.insert(agentTable).values({ id: agentId, name: 'Agent', type: 'pi', instructions: '', orderKey: 'a0' }).run()
    memory = new MemoryService()
    migration = new MemoryMigrationService()
    MockApplicationUtils.setService('MemoryService', memory)
    MockApplicationUtils.setService('MemoryMigrationService', migration)
    await memory._doInit()
    await migration._doInit()
  })

  afterEach(async () => {
    await migration._doStop()
    await memory._doStop()
    MockApplicationUtils.resetServices()
    vi.restoreAllMocks()
    await removeFixture(fixture)
  })

  const stateRow = () =>
    dbh.db
      .select()
      .from(appStateTable)
      .where(eq(appStateTable.key, `memory:migration:${agentId}`))
      .get()!

  it('activates once after backing up exact FACT bytes and leaves the journal untouched', async () => {
    const original = Buffer.from('# Preferences\r\n\r\n保留原文和限制条件。\r\n')
    await writeFile(path.join(root, 'memory', 'FACT.md'), original)
    await writeFile(path.join(root, 'memory', 'JOURNAL.md'), 'Historical journal')
    expect(await Promise.all([migration.ensureAgent(agentId), migration.ensureAgent(agentId)])).toEqual([true, true])
    expect(await readFile(path.join(root, 'MEMORY.md'))).toEqual(original)
    expect(await readFile(path.join(root, 'memory', 'FACT.md'))).toEqual(original)
    expect(await readFile(path.join(root, 'memory', 'JOURNAL.md'), 'utf8')).toBe('Historical journal')
    const backups = path.join(fixture, 'feature.memory.backups', 'agent', agentId)
    const files = await readdir(backups)
    expect(files).toHaveLength(1)
    const batch = JSON.parse(await readFile(path.join(backups, files[0]), 'utf8'))
    expect(Buffer.from(batch.legacy.content, 'base64')).toEqual(original)
    expect(stateRow().value).toMatchObject({ status: 'complete', backupId: batch.id })
    expect(JSON.stringify(stateRow().value)).not.toContain('保留原文')
    expect(await migration.ensureAgent(agentId)).toBe(true)
    expect(await readdir(backups)).toEqual(files)
  })

  it('keeps an indivisible oversized FACT inactive until an explicit retry after correction', async () => {
    const original = '# One indivisible fact\n' + '界'.repeat(9000)
    await writeFile(path.join(root, 'memory', 'FACT.md'), original)
    expect(await migration.ensureAgent(agentId)).toBe(false)
    expect(migration.isMigrated(agentId)).toBe(false)
    expect(await readFile(path.join(root, 'memory', 'FACT.md'), 'utf8')).toBe(original)
    const session = memory.open({ scope: { kind: 'private', agentId }, assertAuthorized: () => undefined })
    await expect(session.read('MEMORY.md')).rejects.toThrow('migration is incomplete')
    await writeFile(path.join(root, 'memory', 'FACT.md'), 'Corrected complete fact')
    expect(await migration.ensureAgent(agentId)).toBe(false)
    migration.retryFromEditor(agentId)
    expect(await migration.ensureAgent(agentId)).toBe(true)
    expect((await session.read('MEMORY.md')).content).toBe('Corrected complete fact')
    session.dispose()
  })

  it.each([
    [
      'split absolute reference',
      '# First\n[source][ref]\n' +
        'a'.repeat(15000) +
        '\n# Second\n' +
        'b'.repeat(15000) +
        '\n\n[ref]: https://example.com/conditions'
    ],
    [
      'split absolute image reference',
      '# First\n![ref][]\n' +
        'a'.repeat(15000) +
        '\n# Second\n' +
        'b'.repeat(15000) +
        '\n\n[ref]: https://example.com/image.png'
    ],
    ['relative link', '[source](../USER.md)'],
    ['relative image', '![source](images/detail.png)'],
    ['reference link', '[source][ref]\n\n[ref]: ../USER.md'],
    ['HTML link', '<a href="../USER.md">source</a>'],
    ['wiki link', '[[#second]]'],
    ['split fragment', '# First\n[condition](#second)\n' + 'a'.repeat(15000) + '\n# Second\n' + 'b'.repeat(15000)]
  ])('retains FACT when relocating its links cannot preserve their targets: %s', async (_name, original) => {
    await writeFile(path.join(root, 'memory', 'FACT.md'), original)
    expect(await migration.ensureAgent(agentId)).toBe(false)
    expect(migration.isMigrated(agentId)).toBe(false)
    expect(await readFile(path.join(root, 'memory', 'FACT.md'), 'utf8')).toBe(original)
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe('')
    expect(await readdir(path.join(root, '.memories'))).toEqual([])
    const session = memory.open({ scope: { kind: 'private', agentId }, assertAuthorized: () => undefined })
    await expect(session.read('MEMORY.md')).rejects.toThrow('migration is incomplete')
    session.dispose()
  })

  it('preserves absolute links and literal link examples during migration', async () => {
    const original =
      '[source][ref]\n\n[ref]: https://example.com/conditions\n\n[source](https://example.com/guide#conditions)\n`[example](../USER.md)`\n```md\n[example](#second)\n```'
    await writeFile(path.join(root, 'memory', 'FACT.md'), original)
    expect(await migration.ensureAgent(agentId)).toBe(true)
    expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe(original)
  })

  it.each([false, true])(
    'reconciles an interrupted marker without replaying changed output (changed=%s)',
    async (changed) => {
      await writeFile(path.join(root, 'memory', 'FACT.md'), 'Original fact')
      expect(await migration.ensureAgent(agentId)).toBe(true)
      const row = stateRow()
      dbh.db
        .update(appStateTable)
        .set({ value: { ...(row.value as object), status: 'pending' } })
        .where(eq(appStateTable.key, row.key))
        .run()
      if (changed) await writeFile(path.join(root, 'MEMORY.md'), 'User edit after interruption')
      expect(await migration.ensureAgent(agentId)).toBe(!changed)
      expect(await readFile(path.join(root, 'MEMORY.md'), 'utf8')).toBe(
        changed ? 'User edit after interruption' : 'Original fact'
      )
      expect(await readFile(path.join(root, 'memory', 'FACT.md'), 'utf8')).toBe('Original fact')
      expect(stateRow().value).toMatchObject({ status: changed ? 'failed' : 'complete' })
    }
  )

  it('keeps complete Markdown sections and fenced headings together when spilling into topics', async () => {
    const first = '# First\n' + 'a'.repeat(15000) + '\n'
    const second = '# Second\n```md\n# Not a section\n' + 'b'.repeat(15000) + '\n```\n'
    const plan = await planLegacyMemory(first + second, '', 'a'.repeat(64))
    expect(plan.get('MEMORY.md')).toContain(first)
    expect([...plan.values()].filter((content) => content.includes(second))).toHaveLength(1)
    expect([...plan.keys()].filter((target) => target !== 'MEMORY.md')).toHaveLength(1)
  })

  it('allows confirmed recovery to unblock a failed migration after normal lifecycle initialization', async () => {
    await writeFile(path.join(root, 'memory', 'FACT.md'), 'Original fact')
    expect(await migration.ensureAgent(agentId)).toBe(true)
    const row = stateRow()
    const session = memory.open({ scope: { kind: 'private', agentId }, assertAuthorized: () => undefined })
    const read = await session.read('MEMORY.md')
    await session.commit(
      [{ kind: 'write', receipt: read.receipt, content: 'Interrupted edit' }],
      async () => () => undefined
    )
    dbh.db
      .update(appStateTable)
      .set({ value: { ...(row.value as object), status: 'pending' } })
      .where(eq(appStateTable.key, row.key))
      .run()
    expect(await migration.ensureAgent(agentId)).toBe(false)
    const recovery = await session.previewRecovery()
    expect(recovery).not.toBeNull()
    await session.recover(recovery!.token, async () => () => undefined)
    expect(await migration.ensureAgent(agentId)).toBe(true)
    expect((await session.read('MEMORY.md')).content).toBe('Original fact')
    session.dispose()
  })
})
