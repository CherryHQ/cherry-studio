import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'

import { checkDshHomeHealth } from '../storageHealth'

describe('checkDshHomeHealth', () => {
  let dir: AbsoluteFilePath

  beforeEach(async () => {
    dir = (await mkdtemp(path.join(tmpdir(), 'deepseek-harness-home-'))) as AbsoluteFilePath
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function writeStore(fileName: string, content: string): Promise<void> {
    await mkdir(path.join(dir, 'storages'), { recursive: true })
    await writeFile(path.join(dir, 'storages', fileName), content, 'utf8')
  }

  it('reports healthy for a fresh home with no store files', async () => {
    await expect(checkDshHomeHealth(dir)).resolves.toEqual({ healthy: true })
  })

  it('reports healthy for a nominally migratable projcache version', async () => {
    await writeStore('session_projcache.json', JSON.stringify({ version: 3, compatibleVersions: [3, 4, 5, 6] }))
    await expect(checkDshHomeHealth(dir)).resolves.toEqual({ healthy: true })
  })

  it('flags a projcache version outside its own compatibleVersions', async () => {
    await writeStore('session_projcache.json', JSON.stringify({ version: 9, compatibleVersions: [3, 4, 5, 6] }))
    await expect(checkDshHomeHealth(dir)).resolves.toEqual({
      healthy: false,
      reason: 'projcache-version',
      detail: expect.stringContaining('version 9')
    })
  })

  it('flags a corrupt projcache file', async () => {
    await writeStore('session_projcache.json', '{not json')
    await expect(checkDshHomeHealth(dir)).resolves.toEqual({
      healthy: false,
      reason: 'projcache-unreadable',
      detail: expect.stringContaining('session_projcache.json')
    })
  })

  it('flags a corrupt workspace file with its own reason code', async () => {
    await writeStore('workspace.json', '{not json')
    await expect(checkDshHomeHealth(dir)).resolves.toEqual({
      healthy: false,
      reason: 'workspace-unreadable',
      detail: expect.stringContaining('workspace.json')
    })
  })

  it('flags workspaces with empty sessionIds while archived sessions exist', async () => {
    await writeStore(
      'workspace.json',
      JSON.stringify({
        unit: { name: 'workspace', version: 2 },
        global: { initialized: true, workspaceIds: ['w1'], archivedSessionIds: ['s1', 's2', 's3', 's4'] },
        tables: { workspaces: { w1: { path: '/tmp/w1', title: 'w1', sessionIds: [] } } }
      })
    )
    await expect(checkDshHomeHealth(dir)).resolves.toEqual({
      healthy: false,
      reason: 'workspace-inconsistent',
      detail: expect.stringContaining('archivedSessionIds')
    })
  })

  it('reports healthy when at least one workspace still owns sessions', async () => {
    await writeStore(
      'workspace.json',
      JSON.stringify({
        global: { archivedSessionIds: ['s1'] },
        tables: { workspaces: { w1: { sessionIds: [] }, w2: { sessionIds: ['s9'] } } }
      })
    )
    await expect(checkDshHomeHealth(dir)).resolves.toEqual({ healthy: true })
  })

  it('fails open on unknown shapes instead of blocking launch', async () => {
    await writeStore('session_projcache.json', JSON.stringify({ version: 'three' }))
    await writeStore('workspace.json', JSON.stringify({ tables: 'unexpected' }))
    await expect(checkDshHomeHealth(dir)).resolves.toEqual({ healthy: true })
  })
})
