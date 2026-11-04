import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { readRestoreJournal } from '@data/db/restore/restoreJournal'

import { collectFailedRestoreTargets, removeFailedRestoreTarget } from '../failedRestore'

const filename = 'work-failed-62f9b5ce-9f03-425e-8448-3a4cd55e971f.sqlite'

describe('failed restore cleanup', () => {
  let root: string
  let candidate: string
  let journalPath: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'failed-restore-cleanup-'))
    candidate = path.join(root, filename)
    journalPath = path.join(root, 'restore-journal.json')
    vi.mocked(application.getPath).mockImplementation((key, child) => {
      const base = key === 'feature.backup.restore.file' ? journalPath : root
      return child ? path.join(base, child) : base
    })
    await fs.writeFile(candidate, 'failed candidate')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('only removes UUID-named root candidates, preserving live, aside, staging and unrelated files', async () => {
    const preserved = [
      'cherrystudio.sqlite',
      'cherrystudio.sqlite.pre-restore-previous',
      'work-failed-manual.sqlite',
      `${filename}.bak`,
      path.join('Data', filename),
      path.join('restore-staging', 'pending', 'work.sqlite')
    ]
    for (const name of preserved) {
      await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true })
      await fs.writeFile(path.join(root, name), 'keep')
    }
    const plan = await collectFailedRestoreTargets()
    expect(plan.targets.map((target) => target.path)).toEqual([candidate])
    expect(await removeFailedRestoreTarget(plan.targets[0])).toEqual({ state: 'cleared' })
    await expect(fs.stat(candidate)).rejects.toMatchObject({ code: 'ENOENT' })
    for (const name of preserved) expect(await fs.readFile(path.join(root, name), 'utf8')).toBe('keep')
  })

  it.each(['staged', 'promoting', 'failed', 'expired', 'completed', 'corrupt'])(
    'preserves candidates when a %s journal exists, including after planning',
    async (state) => {
      const plan = await collectFailedRestoreTargets()
      const journal = {
        version: 1,
        restoreId: 'pending',
        createdAt: '2026-10-11T00:00:00.000Z',
        state,
        ...(state === 'staged' ? {} : { step: 'live-aside' }),
        db: {
          promote: 'restore-staging/pending/work.sqlite',
          aside: 'restore-staging/pending/aside.sqlite',
          fingerprint: 'ab'.repeat(32),
          chain: [{ folderMillis: 1730000000000, hash: 'migration' }]
        },
        fileResources: []
      }
      await fs.writeFile(journalPath, state === 'corrupt' ? '{' : JSON.stringify(journal))
      expect(readRestoreJournal().kind).toBe(state === 'corrupt' ? 'corrupt' : 'ok')
      expect((await collectFailedRestoreTargets()).targets).toEqual([])
      expect(await removeFailedRestoreTarget(plan.targets[0])).toEqual({ state: 'skipped' })
      expect(await fs.readFile(candidate, 'utf8')).toBe('failed candidate')
    }
  )

  it('preserves candidates when the journal cannot be read', async () => {
    const plan = await collectFailedRestoreTargets()
    await fs.mkdir(journalPath)
    expect((await collectFailedRestoreTargets()).targets).toEqual([])
    expect(await removeFailedRestoreTarget(plan.targets[0])).toEqual({ state: 'skipped' })
    expect(await fs.readFile(candidate, 'utf8')).toBe('failed candidate')
  })

  it('rejects a candidate replaced by a directory after planning', async () => {
    const plan = await collectFailedRestoreTargets()
    await fs.unlink(candidate)
    await fs.mkdir(candidate)
    await fs.writeFile(path.join(candidate, 'keep'), 'keep')
    expect(await removeFailedRestoreTarget(plan.targets[0])).toEqual({ state: 'skipped' })
    expect((await collectFailedRestoreTargets()).targets).toEqual([])
    expect(await fs.readFile(path.join(candidate, 'keep'), 'utf8')).toBe('keep')
  })

  it('rejects a candidate replaced by a symbolic link after planning', async () => {
    const plan = await collectFailedRestoreTargets()
    const live = path.join(root, 'cherrystudio.sqlite')
    await fs.writeFile(live, 'keep')
    await fs.unlink(candidate)
    await fs.symlink(live, candidate, 'file')
    expect(await removeFailedRestoreTarget(plan.targets[0])).toEqual({ state: 'skipped' })
    expect((await collectFailedRestoreTargets()).targets).toEqual([])
    expect(await fs.readFile(live, 'utf8')).toBe('keep')
    expect((await fs.lstat(candidate)).isSymbolicLink()).toBe(true)
  })
})
