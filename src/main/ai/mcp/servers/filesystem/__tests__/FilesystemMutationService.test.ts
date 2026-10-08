import * as fs from 'node:fs/promises'
import path from 'path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof fs>())
}))

vi.mock('@main/core/platform', () => ({
  isMac: true,
  isWin: false,
  isLinux: false,
  isDev: false,
  isPortable: false,
  isDarwinX64: false,
  isWinArm64: false
}))

import { filesystemMutationService } from '../FilesystemMutationService'
import { handleEditTool } from '../tools/edit'
import { handleWriteTool } from '../tools/write'

describe('filesystem mutations with mac case folding', () => {
  const tempDirs: string[] = []

  async function createTempDir(prefix: string) {
    const tempRoot = path.join(process.cwd(), '.context', 'vitest-temp')
    await fs.mkdir(tempRoot, { recursive: true })
    const tempDir = await fs.mkdtemp(path.join(tempRoot, prefix))
    tempDirs.push(tempDir)
    return tempDir
  }

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })))
  })

  it('allows a different file to finish while a mutation is waiting on I/O', async () => {
    const workspaceRoot = await createTempDir('mutation-independent-')
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let started!: () => void
    const start = new Promise<void>((resolve) => {
      started = resolve
    })
    const first = filesystemMutationService.runExclusive('a.txt', workspaceRoot, async () => {
      started()
      await gate
      await fs.writeFile(path.join(workspaceRoot, 'a.txt'), 'first')
    })

    try {
      await start
      await handleWriteTool({ file_path: 'b.txt', content: 'second' }, workspaceRoot)
      expect(await fs.readFile(path.join(workspaceRoot, 'b.txt'), 'utf-8')).toBe('second')
      await expect(fs.stat(path.join(workspaceRoot, 'a.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      release()
      await first
    }
  })

  it('continues queued mutations after an edit fails', async () => {
    const workspaceRoot = await createTempDir('mutation-recovery-')
    const filePath = path.join(workspaceRoot, 'target.txt')
    await fs.writeFile(filePath, 'a')
    const results = await Promise.allSettled([
      handleEditTool({ file_path: 'target.txt', old_string: 'missing', new_string: 'unused' }, workspaceRoot),
      handleEditTool({ file_path: 'target.txt', old_string: 'a', new_string: 'b' }, workspaceRoot)
    ])
    expect(results[0].status).toBe('rejected')
    expect(results[1].status).toBe('fulfilled')
    expect(await fs.readFile(filePath, 'utf-8')).toBe('b')
  })

  it('continues admission after rejecting a path outside the workspace', async () => {
    const workspaceRoot = await createTempDir('mutation-validation-recovery-')
    await expect(handleWriteTool({ file_path: '../outside.txt', content: 'denied' }, workspaceRoot)).rejects.toThrow(
      'outside the configured workspace root'
    )
    await handleWriteTool({ file_path: 'allowed.txt', content: 'allowed' }, workspaceRoot)
    expect(await fs.readFile(path.join(workspaceRoot, 'allowed.txt'), 'utf-8')).toBe('allowed')
  })

  it('serializes hard-link alias edits with an in-flight create that lacked inode identity', async () => {
    const workspaceRoot = await createTempDir('mutation-hardlink-create-race-')
    const primaryPath = path.join(workspaceRoot, 'primary.txt')
    const aliasPath = path.join(workspaceRoot, 'alias.txt')

    let releaseFirstWrite!: () => void
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve
    })
    let firstWriteLanded!: () => void
    const firstWriteLandedGate = new Promise<void>((resolve) => {
      firstWriteLanded = resolve
    })

    const originalWriteFile = fs.writeFile.bind(fs)
    let firstPrimaryWrite = true
    vi.spyOn(fs, 'writeFile').mockImplementation(async (...args: Parameters<typeof fs.writeFile>) => {
      const [targetPath] = args
      if (firstPrimaryWrite && typeof targetPath === 'string' && targetPath === primaryPath) {
        firstPrimaryWrite = false
        const result = await (
          originalWriteFile as (...writeArgs: Parameters<typeof fs.writeFile>) => ReturnType<typeof fs.writeFile>
        )(...args)
        firstWriteLanded()
        await fs.link(primaryPath, aliasPath)
        await firstWriteGate
        return result
      }
      return (originalWriteFile as (...writeArgs: Parameters<typeof fs.writeFile>) => ReturnType<typeof fs.writeFile>)(
        ...args
      )
    })

    const firstCreate = handleWriteTool({ file_path: 'primary.txt', content: 'first' }, workspaceRoot)
    await firstWriteLandedGate
    const secondEdit = handleEditTool(
      { file_path: 'alias.txt', old_string: 'first', new_string: 'second' },
      workspaceRoot
    )
    releaseFirstWrite()
    await Promise.all([firstCreate, secondEdit])

    expect(await fs.readFile(primaryPath, 'utf-8')).toBe('second')
  })

  it('preserves call order for hard-link aliases when folding would miss the entry', async () => {
    const workspaceRoot = await createTempDir('mutation-lock-hardlink-case-root-')
    const filePath = path.join(workspaceRoot, 'original.txt')
    await fs.writeFile(filePath, 'a')
    await fs.link(filePath, path.join(workspaceRoot, 'ALIAS.txt'))

    const originalRealpath = fs.realpath.bind(fs)
    let delayedFirstValidation = false
    vi.spyOn(fs, 'realpath').mockImplementation(async (...args: Parameters<typeof fs.realpath>) => {
      if (!delayedFirstValidation) {
        delayedFirstValidation = true
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      return (originalRealpath as (...realpathArgs: Parameters<typeof fs.realpath>) => ReturnType<typeof fs.realpath>)(
        ...args
      )
    })

    await Promise.all([
      handleEditTool({ file_path: 'original.txt', old_string: 'a', new_string: 'b' }, workspaceRoot),
      handleEditTool({ file_path: 'ALIAS.txt', old_string: 'b', new_string: 'c' }, workspaceRoot)
    ])

    await expect(fs.readFile(filePath, 'utf-8')).resolves.toBe('c')
  })
})
