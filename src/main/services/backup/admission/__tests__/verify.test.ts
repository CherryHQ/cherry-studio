import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_DIR_SCAN_LIMITS } from '../../dirScan'
import type { ResourcePayload } from '../../manifest'
import type { CoverageUnit } from '../layout'
import { verifyResourcePayloads, verifyStagedTree } from '../verify'

let staging: string

beforeEach(async () => {
  staging = await mkdtemp(path.join(tmpdir(), 'bk-verify-'))
})
afterEach(async () => {
  await rm(staging, { recursive: true, force: true })
})

function unit(archivePath: string, resourceType: 'file' | 'directory'): CoverageUnit {
  const payload: ResourcePayload = {
    kind: 'k',
    resourceType,
    archivePath,
    livePath: `Data/${archivePath}`,
    hash: '0'.repeat(64),
    sizeBytes: 0
  }
  return { payload, isDirectory: resourceType === 'directory' }
}

describe('verifyStagedTree', () => {
  it('returns the resource files of a clean tree', async () => {
    await mkdir(path.join(staging, 'resources', 'kb'), { recursive: true })
    await writeFile(path.join(staging, 'backup.sqlite'), 'db')
    await writeFile(path.join(staging, 'resources', 'blob.bin'), 'b')
    await writeFile(path.join(staging, 'resources', 'kb', 'a.txt'), 'a')
    const files = await verifyStagedTree(staging, undefined)
    expect(files.sort()).toEqual(['resources/blob.bin', 'resources/kb/a.txt'])
  })

  it('rejects a staged symlink node (staging-escape)', async () => {
    await mkdir(path.join(staging, 'resources'), { recursive: true })
    await writeFile(path.join(staging, 'outside-target'), 'x')
    await symlink(path.join(staging, 'outside-target'), path.join(staging, 'resources', 'link'))
    await expect(verifyStagedTree(staging, undefined)).rejects.toMatchObject({ reason: 'staging-escape' })
  })
})

describe('verifyResourcePayloads — type mismatch', () => {
  it('rejects a directory unit whose staged node is a regular file', async () => {
    await mkdir(path.join(staging, 'resources'), { recursive: true })
    await writeFile(path.join(staging, 'resources', 'kb'), 'not-a-dir')
    await expect(
      verifyResourcePayloads(
        staging,
        [unit('resources/kb', 'directory')],
        ['resources/kb'],
        DEFAULT_DIR_SCAN_LIMITS,
        undefined
      )
    ).rejects.toMatchObject({ reason: 'payload-mismatch' })
  })

  it('rejects a file unit whose staged node is a directory', async () => {
    await mkdir(path.join(staging, 'resources', 'blob'), { recursive: true })
    await expect(
      verifyResourcePayloads(staging, [unit('resources/blob', 'file')], [], DEFAULT_DIR_SCAN_LIMITS, undefined)
    ).rejects.toMatchObject({ reason: 'payload-mismatch' })
  })
})
