import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { agentWorkspaceStorageService } from '@main/ai/agents/AgentWorkspaceStorageService'

import { prepareWorkspaceRoute } from '../openWorkspace'

describe('prepareWorkspaceRoute', () => {
  const dbh = setupTestDatabase()
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'open-workspace-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  it('registers a directory, reuses its id and name, and never creates a session', async () => {
    const directory = path.join(root, 'spaces 中文 + # 100%')
    await mkdir(directory)
    const route = await prepareWorkspaceRoute(`${directory}${path.sep}`)
    const [row] = dbh.db.select().from(agentWorkspaceTable).all()
    expect(row).toMatchObject({ path: directory, type: 'user' })
    expect(route).toBe(`/app/agents?workspaceId=${row.id}`)
    agentWorkspaceService.update(row.id, { name: 'My project' })
    expect(await prepareWorkspaceRoute(directory)).toBe(route)
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toMatchObject([{ id: row.id, name: 'My project' }])
    expect(dbh.db.select().from(agentSessionTable).all()).toEqual([])
  })

  it.each(['', 'relative/project', 'file:///folder', 'file://remote/folder', '/bad\0path'])(
    'rejects non-native or invalid input %j',
    async (input) => {
      expect(await prepareWorkspaceRoute(input)).toBeUndefined()
      expect(dbh.db.select().from(agentWorkspaceTable).all()).toEqual([])
    }
  )

  it('rejects files, missing directories, and symlink loops', async () => {
    const file = path.join(root, 'file')
    const loop = path.join(root, 'loop')
    await writeFile(file, '')
    await symlink(loop, loop)
    for (const input of [file, path.join(root, 'missing'), loop]) {
      expect(await prepareWorkspaceRoute(input)).toBeUndefined()
    }
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toEqual([])
  })

  it('accepts a directory symlink without changing the lexical identity policy', async () => {
    const directory = path.join(root, 'directory')
    const link = path.join(root, 'link')
    await mkdir(directory)
    await symlink(directory, link)
    expect(await prepareWorkspaceRoute(link)).toMatch(/^\/app\/agents\?workspaceId=.+/)
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toMatchObject([{ path: link }])
  })

  it.skipIf(process.platform === 'win32')(
    'rejects distinct directories whose names differ by normalization trimming',
    async () => {
      await mkdir(path.join(root, 'project'))
      await mkdir(path.join(root, 'project '))
      expect(await prepareWorkspaceRoute(path.join(root, 'project '))).toBeUndefined()
      expect(dbh.db.select().from(agentWorkspaceTable).all()).toEqual([])
    }
  )

  it.skipIf(process.platform === 'win32')(
    'rejects lexical normalization across a symlink and .. when it changes directory identity',
    async () => {
      await mkdir(path.join(root, 'other', 'nested'), { recursive: true })
      await symlink(path.join(root, 'other', 'nested'), path.join(root, 'link'))
      expect(await prepareWorkspaceRoute(`${root}/link/..`)).toBeUndefined()
      expect(dbh.db.select().from(agentWorkspaceTable).all()).toEqual([])
    }
  )

  it('swallows registration errors without creating a row', async () => {
    vi.spyOn(agentWorkspaceStorageService, 'registerWorkspace').mockImplementationOnce(() => {
      throw new Error('DB failed')
    })
    expect(await prepareWorkspaceRoute(root)).toBeUndefined()
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toEqual([])
  })

  it('preserves system workspace collision protection', async () => {
    vi.spyOn(application, 'getPath').mockReturnValue(root)
    const workspace = application
      .get('DbService')
      .withWriteTx((tx) =>
        agentWorkspaceService.createSystemWorkspaceForSessionTx(tx, { sessionId: 'system', createdAt: Date.now() })
      )
    await mkdir(workspace.path, { recursive: true })
    expect(await prepareWorkspaceRoute(workspace.path)).toBeUndefined()
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toMatchObject([{ id: workspace.id, type: 'system' }])
  })
})
