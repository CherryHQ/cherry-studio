import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { checkWorkspacePathStatus, formatWorkspacePathStatus } from '../workspacePathStatus'

describe('workspacePathStatus', () => {
  it('returns ok for existing directories', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-status-'))

    expect(checkWorkspacePathStatus(workspace)).toEqual({ ok: true })
  })

  it('returns missing for paths that do not exist', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-status-'))
    const workspace = path.join(root, 'missing')

    expect(checkWorkspacePathStatus(workspace)).toMatchObject({ ok: false, reason: 'missing' })
  })

  it('returns not-directory for files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-status-'))
    const workspace = path.join(root, 'file.txt')
    await writeFile(workspace, 'not a directory')

    expect(checkWorkspacePathStatus(workspace)).toEqual({ ok: false, reason: 'not-directory' })
  })

  it('formats status messages used by the dispatch guard', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-status-'))
    const workspace = path.join(root, 'deleted')
    await rm(workspace, { recursive: true, force: true })
    const status = checkWorkspacePathStatus(workspace)

    expect(status.ok).toBe(false)
    if (!status.ok) {
      expect(formatWorkspacePathStatus(workspace, status)).toContain(`Workspace path does not exist: ${workspace}`)
    }
  })
})
