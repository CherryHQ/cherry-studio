import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { verifyStagedTree } from '../verify'

describe('verifyStagedTree', () => {
  let staging: string

  beforeEach(async () => {
    staging = await mkdtemp(path.join(tmpdir(), 'backup-verify-'))
  })
  afterEach(async () => {
    await rm(staging, { recursive: true, force: true })
  })

  it('accepts exactly the two regular Lite entries', async () => {
    await writeFile(path.join(staging, 'manifest.json'), '{}')
    await writeFile(path.join(staging, 'backup.sqlite'), 'db')
    await expect(verifyStagedTree(staging, undefined)).resolves.toBeUndefined()
  })

  it.each(['extra.txt', 'resources'])('rejects an extra staged node: %s', async (name) => {
    await writeFile(path.join(staging, 'manifest.json'), '{}')
    await writeFile(path.join(staging, 'backup.sqlite'), 'db')
    if (name === 'resources') await mkdir(path.join(staging, name))
    else await writeFile(path.join(staging, name), 'x')
    await expect(verifyStagedTree(staging, undefined)).rejects.toMatchObject({ reason: 'layout' })
  })

  it('rejects a symlink replacement', async () => {
    await writeFile(path.join(staging, 'manifest.json'), '{}')
    const outside = path.join(staging, '..', 'outside.sqlite')
    await writeFile(outside, 'db')
    await symlink(outside, path.join(staging, 'backup.sqlite'))
    await expect(verifyStagedTree(staging, undefined)).rejects.toMatchObject({ reason: 'staging-escape' })
  })
})
