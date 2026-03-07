import fs from 'fs/promises'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'

import { resolveFilesystemBaseDir } from '../config'
import { validatePath } from '../types'

describe('filesystem MCP security', () => {
  const tempDirs: string[] = []

  async function createTempDir(prefix: string) {
    const tempRoot = path.join(process.cwd(), '.context', 'vitest-temp')
    await fs.mkdir(tempRoot, { recursive: true })
    const tempDir = await fs.mkdtemp(path.join(tempRoot, prefix))
    tempDirs.push(tempDir)
    return tempDir
  }

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })))
  })

  it('prefers WORKSPACE_ROOT and falls back to args for filesystem root', () => {
    expect(resolveFilesystemBaseDir(['C:/args-root'], {})).toBe('C:/args-root')
    expect(resolveFilesystemBaseDir(['C:/args-root'], { WORKSPACE_ROOT: 'C:/env-root' })).toBe('C:/env-root')
    expect(resolveFilesystemBaseDir([], {})).toBeUndefined()
  })

  it('allows paths inside the configured root and rejects paths outside it', async () => {
    const workspaceRoot = await createTempDir('filesystem-root-')
    const outsideRoot = await createTempDir('filesystem-outside-')
    const insideFile = path.join(workspaceRoot, 'inside.txt')
    const outsideFile = path.join(outsideRoot, 'outside.txt')

    await fs.writeFile(insideFile, 'inside')
    await fs.writeFile(outsideFile, 'outside')

    await expect(validatePath(insideFile, workspaceRoot)).resolves.toBe(insideFile)
    await expect(validatePath(outsideFile, workspaceRoot)).rejects.toThrow('outside the configured workspace root')
  })

  it('rejects symlink escapes outside the configured root', async () => {
    const workspaceRoot = await createTempDir('filesystem-symlink-root-')
    const outsideRoot = await createTempDir('filesystem-symlink-outside-')
    const outsideFile = path.join(outsideRoot, 'secret.txt')
    const symlinkPath = path.join(workspaceRoot, 'escape-link')

    await fs.writeFile(outsideFile, 'top-secret')
    await fs.symlink(outsideFile, symlinkPath)

    await expect(validatePath(symlinkPath, workspaceRoot)).rejects.toThrow('outside the configured workspace root')
  })
})
