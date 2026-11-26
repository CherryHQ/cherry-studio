import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildRegistrySyncRequest } from '../buildRegistrySyncRequest'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('buildRegistrySyncRequest', () => {
  it('includes catalog files larger than Linux single-argument limits without truncation', () => {
    const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-sync-request-'))
    temporaryDirectories.push(rootDirectory)
    const catalogPath = 'v1/provider-models.json'
    const catalog = Buffer.alloc(1_200_000, 'x')
    fs.mkdirSync(path.join(rootDirectory, 'v1'))
    const catalogFile = path.join(rootDirectory, catalogPath)
    fs.writeFileSync(catalogFile, catalog)
    execFileSync('git', ['init', '--quiet'], { cwd: rootDirectory })
    execFileSync('git', ['add', '--', catalogPath], { cwd: rootDirectory })
    fs.writeFileSync(catalogFile, 'unstaged edit')

    const request = buildRegistrySyncRequest({
      rootDirectory,
      additionPaths: [catalogPath],
      deletionPaths: ['v1/removed.json'],
      refId: 'branch-id',
      expectedHeadOid: 'head-oid',
      headline: 'sync catalog',
      body: 'source revision'
    })

    const input = request.variables.input
    expect(input.fileChanges.additions).toHaveLength(1)
    expect(input.fileChanges.additions[0].path).toBe(catalogPath)
    const uploaded = Buffer.from(input.fileChanges.additions[0].contents, 'base64')
    expect(uploaded.length).toBe(catalog.length)
    expect(uploaded.equals(catalog)).toBe(true)
    expect(input.fileChanges.deletions).toEqual([{ path: 'v1/removed.json' }])
  })
})
