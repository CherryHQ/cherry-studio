import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import type * as Platform from '@main/core/platform'

vi.mock('@main/core/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof Platform>()),
  isPortable: false
}))

import { WorkspaceInstallDirectoryError } from '../agentWorkspaceInstallDirectory'
import { agentWorkspaceStorageService as service } from '../AgentWorkspaceStorageService'

describe('workspace registration installation guard', () => {
  const dbh = setupTestDatabase()
  const originalPackaged = app.isPackaged
  let root: string
  let installDirectory: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'workspace-register-'))
    installDirectory = path.join(root, 'Cherry Studio')
    await mkdir(installDirectory)
    ;(app as { isPackaged: boolean }).isPackaged = true
    vi.spyOn(application, 'getPath').mockImplementation((key) => {
      if (key === 'app.install') return installDirectory
      if (key === 'feature.agents.system_workspaces') return root
      throw new Error(`Unexpected path: ${key}`)
    })
  })

  afterEach(async () => {
    ;(app as { isPackaged: boolean }).isPackaged = originalPackaged
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  it('rejects before the DB write and leaves storage available for reservation', () => {
    const workspacePath = path.join(installDirectory, 'work')
    const existingReservation = service.reserveWorkspaceStorage([workspacePath])
    try {
      expect(() => service.registerWorkspace(path.join(installDirectory, 'other', '..', 'work'))).toThrow(
        WorkspaceInstallDirectoryError
      )
    } finally {
      existingReservation?.()
    }
    expect(() => service.registerWorkspace(workspacePath)).toThrow(
      expect.objectContaining({ workspacePath, installDirectory, reason: 'install_directory' })
    )
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toEqual([])
    const release = service.reserveWorkspaceStorage([workspacePath])
    try {
      expect(release).toBeTypeOf('function')
    } finally {
      release?.()
    }
  })

  it('registers an outside directory and preserves the supplied name', () => {
    const workspacePath = path.join(root, 'projects')
    const workspace = service.registerWorkspace(workspacePath, { name: 'My project' })
    expect(workspace).toMatchObject({ path: workspacePath, name: 'My project', type: 'user' })
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toEqual([
      expect.objectContaining({ id: workspace.id, path: workspacePath, name: 'My project' })
    ])
  })

  it.each(['\\', '/', '\\\\', '//', '\\/', '/\\', '\\/work/..\\', '\\/work/..\\/work/..\\'])(
    'rejects separator and parent traversal variants without DB writes or reservation leaks: %s',
    (suffix) => {
      for (const workspacePath of [installDirectory, path.join(installDirectory, 'work')]) {
        expect(() => service.registerWorkspace(`  ${workspacePath}${suffix}  `)).toThrow(
          expect.objectContaining({ workspacePath, installDirectory, reason: 'install_directory' })
        )
        expect(dbh.db.select().from(agentWorkspaceTable).all()).toEqual([])
        const release = service.reserveWorkspaceStorage([workspacePath])
        try {
          expect(release).toBeTypeOf('function')
        } finally {
          release?.()
        }
      }
    }
  )

  it.each(['\\', '\\/work/..\\', '\\/work/..\\/work/..\\'])(
    'checks reservations against the stable normalized persisted path: %s',
    (suffix) => {
      const workspacePath = path.join(root, 'projects')
      const release = service.reserveWorkspaceStorage([workspacePath])
      try {
        expect(release).toBeTypeOf('function')
        expect(() => service.registerWorkspace(`  ${workspacePath}${suffix}  `)).toThrow('Workspace storage is in use')
        expect(dbh.db.select().from(agentWorkspaceTable).all()).toEqual([])
      } finally {
        release?.()
      }
      const workspace = service.registerWorkspace(`  ${workspacePath}${suffix}  `)
      expect(workspace.path).toBe(workspacePath)
      expect(service.registerWorkspace(workspacePath).id).toBe(workspace.id)
      expect(dbh.db.select().from(agentWorkspaceTable).all()).toEqual([
        expect.objectContaining({ id: workspace.id, path: workspacePath })
      ])
    }
  )
})
