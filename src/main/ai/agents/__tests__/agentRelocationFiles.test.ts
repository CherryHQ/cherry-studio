import { link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isSameRelocationArtifact, relocationArtifactExists } from '../agentRelocationFiles'

describe('isSameRelocationArtifact', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cs-relocation-files-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('returns true for identical path strings', async () => {
    const dir = path.join(root, 'same-dir')
    await expect(isSameRelocationArtifact(dir, dir)).resolves.toBe(true)
  })

  it('returns false when either path does not exist or when directories are distinct', async () => {
    const source = path.join(root, 'source-dir')
    const missing = path.join(root, 'missing-dir')
    const other = path.join(root, 'other-dir')
    await mkdir(source)
    await mkdir(other)

    await expect(isSameRelocationArtifact(source, missing)).resolves.toBe(false)
    await expect(isSameRelocationArtifact(source, other)).resolves.toBe(false)
  })

  it('returns false for distinct hardlinked files sharing an inode', async () => {
    const first = path.join(root, 'first.jsonl')
    const second = path.join(root, 'second.jsonl')
    await writeFile(first, 'history')
    await link(first, second)

    await expect(isSameRelocationArtifact(first, second)).resolves.toBe(false)
  })

  it('returns false when one path is a symbolic link or junction to the other', async () => {
    const realDir = path.join(root, 'real-dir')
    const linkedDir = path.join(root, 'linked-dir')
    await mkdir(realDir)
    await symlink(realDir, linkedDir, process.platform === 'win32' ? 'junction' : 'dir')

    await expect(isSameRelocationArtifact(realDir, linkedDir)).resolves.toBe(false)
    await expect(isSameRelocationArtifact(linkedDir, realDir)).resolves.toBe(false)
  })

  it('detects case-variant aliases on case-insensitive filesystems without collapsing distinct entries', async () => {
    const lower = path.join(root, 'D--Cherry-Studio-data-session')
    const upper = path.join(root, 'D--Cherry-Studio-Data-session')
    await mkdir(lower)

    const isCaseInsensitiveVolume = await relocationArtifactExists(upper)
    if (isCaseInsensitiveVolume) {
      await expect(isSameRelocationArtifact(lower, upper)).resolves.toBe(true)
    } else {
      await mkdir(upper)
      await expect(isSameRelocationArtifact(lower, upper)).resolves.toBe(false)
    }
  })
})
