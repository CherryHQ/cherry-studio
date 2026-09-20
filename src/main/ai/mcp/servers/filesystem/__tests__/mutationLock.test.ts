import fs from 'fs/promises'
import path from 'path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/core/platform', () => ({
  isMac: true,
  isWin: false,
  isLinux: false,
  isDev: false,
  isPortable: false,
  isDarwinX64: false,
  isWinArm64: false
}))

import { resolveMutationLockKeys } from '../mutationLock'
import { handleEditTool } from '../tools/edit'

describe('mutationLock mac case folding', () => {
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

  it('keeps the stat probe unfolded while folding the path key', async () => {
    const workspaceRoot = await createTempDir('mutation-lock-probe-root-')
    const filePath = path.join(workspaceRoot, 'Original.txt')
    await fs.writeFile(filePath, 'a')

    const keys = resolveMutationLockKeys('Original.txt', workspaceRoot)

    expect(keys.probePath.endsWith('Original.txt')).toBe(true)
    expect(keys.pathKey.endsWith('original.txt')).toBe(true)
    await expect(fs.stat(keys.probePath)).resolves.toMatchObject({ ino: expect.anything() })
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
