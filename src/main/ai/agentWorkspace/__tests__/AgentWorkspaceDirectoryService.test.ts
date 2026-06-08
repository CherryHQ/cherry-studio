import { application } from '@application'
import { ErrorCode } from '@shared/data/api'
import { mkdtemp, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { agentWorkspaceDirectoryService } from '../AgentWorkspaceDirectoryService'

describe('AgentWorkspaceDirectoryService', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-dir-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.agents.workspaces') {
        return filename ? path.join(root, 'Agents', filename) : path.join(root, 'Agents')
      }
      return filename ? path.join('/mock', key, filename) : path.join('/mock', key)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizes paths and creates the backing directory', async () => {
    const rawPath = path.join(root, 'project', '..', 'project')
    const workspacePath = agentWorkspaceDirectoryService.ensureWorkspaceDirectory(rawPath)

    expect(workspacePath).toBe(path.join(root, 'project'))
    const stats = await stat(workspacePath)
    expect(stats.isDirectory()).toBe(true)
  })

  it('rejects relative workspace paths', () => {
    expect(() => agentWorkspaceDirectoryService.ensureWorkspaceDirectory('relative/project')).toThrow(
      expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR })
    )
  })

  it('rejects empty workspace paths', () => {
    expect(() => agentWorkspaceDirectoryService.ensureWorkspaceDirectory('   ')).toThrow(
      expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR })
    )
  })

  it('surfaces directory creation failures', async () => {
    const filePath = path.join(root, 'not-a-directory')
    await writeFile(filePath, 'file blocks recursive mkdir')

    expect(() => agentWorkspaceDirectoryService.ensureWorkspaceDirectory(path.join(filePath, 'child'))).toThrow()
  })

  it('prepares and cleans up default workspace directories', async () => {
    const workspacePath = agentWorkspaceDirectoryService.prepareDefaultWorkspaceDirectory()

    expect(workspacePath.startsWith(path.join(root, 'Agents'))).toBe(true)
    await expect(stat(workspacePath)).resolves.toMatchObject({ isDirectory: expect.any(Function) })

    agentWorkspaceDirectoryService.cleanupPreparedWorkspaceDirectory(workspacePath)

    await expect(stat(workspacePath)).rejects.toThrow()
  })
})
