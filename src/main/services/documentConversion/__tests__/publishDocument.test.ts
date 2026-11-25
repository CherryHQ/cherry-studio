import type * as NodeFsPromises from 'node:fs/promises'
import { access, lstat, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

const createdInode = 2n ** 53n
const replacementInode = createdInode + 1n

const control = vi.hoisted(() => ({
  enabled: false,
  resourcePath: '',
  primaryRealIno: undefined as bigint | undefined
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>()
  return {
    ...actual,
    lstat: (async (target: string, options?: { bigint?: boolean }) => {
      const resolved = path.resolve(String(target))
      if (!control.enabled || !control.resourcePath || resolved !== path.resolve(control.resourcePath)) {
        return actual.lstat(target, options)
      }
      const requestedBigint = options?.bigint === true
      const real = await actual.lstat(target, { bigint: true })
      if (control.primaryRealIno === undefined) control.primaryRealIno = real.ino
      const injected = real.ino === control.primaryRealIno ? createdInode : replacementInode
      const stats = requestedBigint ? real : await actual.lstat(target)
      stats.ino = requestedBigint ? injected : Number(injected)
      return stats
    }) as typeof actual.lstat
  }
})

import { publishDocument } from '../publishDocument'

const documentBytes = Buffer.from('converted document')
const assetBytes = Buffer.from('asset')
const document = {
  bytes: documentBytes,
  assets: new Map([['image-1.png', assetBytes]]),
  resourceDirectory: 'report.assets',
  warnings: []
}

describe('publishDocument resource identity', () => {
  let root: string
  let workspacePath: string
  let outputPath: string
  let resourcePath: string
  let preservedPath: string

  beforeEach(async () => {
    control.enabled = false
    control.primaryRealIno = undefined
    root = await mkdtemp(path.join(tmpdir(), 'publish-document-'))
    const tempRoot = path.join(root, 'temp')
    workspacePath = path.join(root, 'workspace')
    await mkdir(tempRoot)
    await mkdir(workspacePath)
    outputPath = path.join(workspacePath, 'report.md')
    resourcePath = path.join(workspacePath, 'report.assets')
    preservedPath = path.join(workspacePath, 'report.assets.original')
    control.resourcePath = resourcePath
    vi.mocked(application.getPath).mockImplementation((_key, filename) =>
      filename ? path.join(tempRoot, filename) : tempRoot
    )
  })

  afterEach(async () => {
    vi.mocked(application.getPath).mockReset()
    await rm(root, { recursive: true, force: true })
  })

  async function replaceResourceDirectory() {
    try {
      await access(resourcePath)
    } catch {
      return false
    }
    await rename(resourcePath, preservedPath)
    await mkdir(resourcePath)
    return true
  }

  async function expectReplacementPreserved() {
    await expect(access(resourcePath)).resolves.toBeUndefined()
    await expect(access(preservedPath)).resolves.toBeUndefined()
    await expect(access(outputPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(resourcePath)).toEqual([])
    control.enabled = false
    const [replacement, original] = await Promise.all([
      lstat(resourcePath, { bigint: true }),
      lstat(preservedPath, { bigint: true })
    ])
    expect(replacement.isDirectory()).toBe(true)
    expect(original.isDirectory()).toBe(true)
    expect(replacement.ino).not.toBe(original.ino)
  }

  it('rejects a replaced resource directory whose inode collides above 2^53 and leaves it in place', async () => {
    expect(createdInode === replacementInode).toBe(false)
    expect(Number(createdInode)).toBe(Number(replacementInode))
    control.enabled = true
    let replaced = false
    await expect(
      publishDocument(document, outputPath, {
        validateTarget: async () => {
          if (replaced) return
          replaced = await replaceResourceDirectory()
        }
      })
    ).rejects.toThrow(/Document resource directory changed during conversion/)
    expect(replaced).toBe(true)
    await expectReplacementPreserved()
  })

  it('does not remove a replacement resource directory when validation refuses publication', async () => {
    control.enabled = true
    await expect(
      publishDocument(document, outputPath, {
        validateTarget: async () => {
          if (await replaceResourceDirectory()) throw new Error('publication refused')
        }
      })
    ).rejects.toThrow('publication refused')
    await expectReplacementPreserved()
  })
})
