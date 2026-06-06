import { application } from '@application'
import { agentWorkspaceDirectoryService } from '@main/services/agentWorkspace/AgentWorkspaceDirectoryService'
import { mkdir, mkdtemp, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('AgentWorkspaceDirectoryService', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-directory-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.agents.workspaces') {
        return filename ? path.join(root, filename) : root
      }
      return filename ? path.join('/mock', key, filename) : path.join('/mock', key)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizes and creates workspace directories', async () => {
    const rawPath = path.join(root, 'project', '..', 'project')
    const normalizedPath = path.join(root, 'project')

    expect(agentWorkspaceDirectoryService.ensureWorkspaceDirectory(rawPath)).toBe(normalizedPath)
    await expect(stat(normalizedPath)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })

  it('rejects invalid workspace directory paths', async () => {
    const filePath = path.join(root, 'not-a-directory')
    await writeFile(filePath, 'file blocks recursive mkdir')

    expect(() => agentWorkspaceDirectoryService.ensureWorkspaceDirectory('relative/project')).toThrow()
    expect(() => agentWorkspaceDirectoryService.ensureWorkspaceDirectory(path.join(filePath, 'child'))).toThrow()
  })

  it('prepares system workspaces under the isolated system subtree', async () => {
    const workspace = agentWorkspaceDirectoryService.prepareSystemWorkspaceForSession(
      '12345678-1234-4000-8000-123456789abc',
      new Date(2026, 4, 25, 14, 30, 12)
    )

    expect(workspace).toMatchObject({
      path: path.join(root, 'system', '2026-05-25', '143012-12345678'),
      label: '2026-05-25 14:30:12'
    })
    await expect(stat(workspace.path)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })

  it('rejects system workspace paths outside the isolated system subtree', async () => {
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-outside-'))

    expect(() =>
      agentWorkspaceDirectoryService.assertSystemWorkspacePath(path.join(root, 'system', '2026-05-25', 'valid'))
    ).not.toThrow()
    expect(() =>
      agentWorkspaceDirectoryService.assertSystemWorkspacePath(path.join(outsideRoot, 'system', '2026-05-25'))
    ).toThrow()
    expect(() =>
      agentWorkspaceDirectoryService.assertSystemWorkspacePath(path.join(root, 'system', '..', 'escaped'))
    ).toThrow()
  })

  it('does not recursively delete non-empty prepared system workspace directories', async () => {
    const workspacePath = path.join(root, 'system', '2026-05-25', 'prepared')
    const sentinelPath = path.join(workspacePath, 'keep.txt')
    await mkdir(workspacePath, { recursive: true })
    await writeFile(sentinelPath, 'keep')

    agentWorkspaceDirectoryService.deletePreparedSystemWorkspaceDirectory({
      path: workspacePath
    })

    await expect(stat(sentinelPath)).resolves.toMatchObject({ isFile: expect.any(Function) })
  })
})
