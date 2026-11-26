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
  it('represents a staged rename as a deletion and an addition', () => {
    const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-sync-request-'))
    temporaryDirectories.push(rootDirectory)
    const git = (...args: string[]) => execFileSync('git', args, { cwd: rootDirectory, encoding: 'utf8' }).trim()
    git('init', '--quiet')
    git('config', 'user.name', 'Registry Sync Test')
    git('config', 'user.email', 'registry-sync@example.test')
    git('config', 'commit.gpgsign', 'false')
    git('config', 'diff.renames', 'true')

    const oldPath = 'old catalog.json'
    const newPath = 'new catalog.json'
    const catalog = '{"models":[]}\n'
    fs.writeFileSync(path.join(rootDirectory, oldPath), catalog)
    git('add', '--', oldPath)
    git('commit', '--quiet', '-m', 'initial catalog')
    git('mv', '--', oldPath, newPath)
    expect(git('diff', '--cached', '--name-status')).toBe(`R100\t${oldPath}\t${newPath}`)

    const output = path.join(rootDirectory, 'request.json')
    execFileSync(process.execPath, [path.resolve(__dirname, '../buildRegistrySyncRequest.js'), output], {
      cwd: rootDirectory,
      env: {
        ...process.env,
        REGISTRY_SYNC_REF_ID: 'branch-id',
        REGISTRY_SYNC_EXPECTED_HEAD_OID: git('rev-parse', 'HEAD'),
        REGISTRY_SYNC_HEADLINE: 'sync catalog',
        REGISTRY_SYNC_BODY: 'source revision'
      }
    })

    const request = JSON.parse(fs.readFileSync(output, 'utf8'))
    expect(request.variables.input.fileChanges).toEqual({
      additions: [{ path: newPath, contents: Buffer.from(catalog).toString('base64') }],
      deletions: [{ path: oldPath }]
    })
  })

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
