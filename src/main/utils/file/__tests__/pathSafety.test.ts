import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  findUnsafeAncestor,
  OwnedPathIdentityError,
  probePath,
  probePathSync,
  removeOwnedDirectory
} from '../pathSafety'

describe('path identity and owned cleanup', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cs-path-safety-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('distinguishes missing, file, directory, and symlink nodes without following links', async () => {
    const file = path.join(root, 'file')
    const directory = path.join(root, 'directory')
    const link = path.join(root, 'link')
    await writeFile(file, 'content')
    await mkdir(directory)
    await symlink(file, link)

    expect(await probePath(path.join(root, 'missing'))).toEqual({ kind: 'missing' })
    expect(await probePath(file)).toMatchObject({ kind: 'present', identity: { nodeType: 'file' } })
    expect(probePathSync(directory)).toMatchObject({ kind: 'present', identity: { nodeType: 'directory' } })
    expect(probePathSync(link)).toMatchObject({ kind: 'present', identity: { nodeType: 'symlink' } })
  })

  it('removes only the directory whose captured identity still matches', async () => {
    const owned = path.join(root, 'owned')
    await mkdir(owned)
    await writeFile(path.join(owned, 'payload'), 'content')
    const captured = await probePath(owned)
    if (captured.kind !== 'present') throw new Error('test setup did not create owned directory')

    await expect(removeOwnedDirectory(owned, captured.identity)).resolves.toBe(true)
    await expect(removeOwnedDirectory(owned, captured.identity)).resolves.toBe(false)
  })

  it('preserves a replacement directory with another inode', async () => {
    const owned = path.join(root, 'owned')
    const displaced = path.join(root, 'displaced')
    await mkdir(owned)
    const captured = await probePath(owned)
    if (captured.kind !== 'present') throw new Error('test setup did not create owned directory')
    await rename(owned, displaced)
    await mkdir(owned)
    await writeFile(path.join(owned, 'replacement'), 'keep')

    await expect(removeOwnedDirectory(owned, captured.identity)).rejects.toBeInstanceOf(OwnedPathIdentityError)
    await expect(readFile(path.join(owned, 'replacement'), 'utf8')).resolves.toBe('keep')
  })

  it('finds a symlinked ancestor before a destructive path is followed', async () => {
    const external = path.join(root, 'external')
    await mkdir(external)
    await symlink(external, path.join(root, 'redirect'))

    expect(findUnsafeAncestor(root, 'redirect/child/value')).toBe('redirect')
    expect(findUnsafeAncestor(root, 'missing/child/value')).toBeNull()
  })
})
