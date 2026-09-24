import { existsSync } from 'node:fs'
import { link, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ensureMcpMemoryFile, memoryFileMigrationHooks } from '../memoryFileMigration'

const SOURCE_GRAPH = {
  entities: [{ name: 'Cherry', entityType: 'project', observations: ['portable'] }],
  relations: [{ from: 'Cherry', to: 'Cherry', relationType: 'knows' }]
}

const TARGET_GRAPH = {
  entities: [{ name: 'Target', entityType: 'device', observations: [] }],
  relations: []
}

describe('ensureMcpMemoryFile', () => {
  let root: string
  let profileRoot: string
  let legacyRoot: string
  let legacyPath: string
  let targetPath: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'mcp-memory-migration-'))
    profileRoot = path.join(root, 'userData')
    legacyRoot = path.join(root, 'legacy')
    await Promise.all([mkdir(profileRoot), mkdir(legacyRoot)])
    legacyPath = path.join(legacyRoot, 'config', 'memory.json')
    targetPath = path.join(profileRoot, 'Data', 'Mcp', 'memory.json')
  })

  afterEach(async () => {
    memoryFileMigrationHooks.afterLegacyRead = async () => {}
    memoryFileMigrationHooks.beforePublish = async () => {}
    memoryFileMigrationHooks.afterPublish = async () => {}
    memoryFileMigrationHooks.hardLink = async (stagingPath, pathToTarget) => {
      await link(stagingPath, pathToTarget)
    }
    memoryFileMigrationHooks.removeStaging = async (stagingDir) => {
      await rm(stagingDir, { recursive: true, force: true })
    }
    await rm(root, { recursive: true, force: true })
  })

  async function writeJson(filePath: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(value, null, 2))
  }

  function migrate(): ReturnType<typeof ensureMcpMemoryFile> {
    return ensureMcpMemoryFile({ legacyPath, legacyRoot, targetPath, profileRoot })
  }

  it('publishes a validated legacy graph without removing the source', async () => {
    await writeJson(legacyPath, SOURCE_GRAPH)

    await expect(migrate()).resolves.toBe('migrated')

    expect(JSON.parse(await readFile(targetPath, 'utf8'))).toEqual(SOURCE_GRAPH)
    expect(JSON.parse(await readFile(legacyPath, 'utf8'))).toEqual(SOURCE_GRAPH)
    if (process.platform !== 'win32') {
      expect((await stat(targetPath)).mode & 0o777).toBe(0o600)
      expect((await stat(path.dirname(targetPath))).mode & 0o777).toBe(0o700)
    }
    expect((await readdir(path.dirname(targetPath))).filter((name) => name.startsWith('.memory-migration-'))).toEqual(
      []
    )
  })

  it('initializes an explicit empty graph when no legacy file exists', async () => {
    await expect(migrate()).resolves.toBe('initialized')

    expect(JSON.parse(await readFile(targetPath, 'utf8'))).toEqual({ entities: [], relations: [] })
  })

  it('keeps an existing profile-owned graph and never overwrites it from legacy state', async () => {
    await writeJson(legacyPath, SOURCE_GRAPH)
    await writeJson(targetPath, TARGET_GRAPH)

    await expect(migrate()).resolves.toBe('already-present')

    expect(JSON.parse(await readFile(targetPath, 'utf8'))).toEqual(TARGET_GRAPH)
    expect(JSON.parse(await readFile(legacyPath, 'utf8'))).toEqual(SOURCE_GRAPH)
  })

  it('rejects malformed legacy content without publishing an empty replacement', async () => {
    await mkdir(path.dirname(legacyPath), { recursive: true })
    await writeFile(legacyPath, '{"entities":"not-an-array"}')

    await expect(migrate()).rejects.toThrow(/invalid knowledge-graph shape/)

    expect(existsSync(targetPath)).toBe(false)
  })

  it.runIf(process.platform !== 'win32')('rejects a legacy symlink without following it', async () => {
    const outside = path.join(root, 'outside.json')
    await writeJson(outside, SOURCE_GRAPH)
    await mkdir(path.dirname(legacyPath), { recursive: true })
    await symlink(outside, legacyPath)

    await expect(migrate()).rejects.toThrow(/real file/)
    expect(existsSync(targetPath)).toBe(false)
  })

  it('does not clobber a target that appears immediately before publication', async () => {
    await writeJson(legacyPath, SOURCE_GRAPH)
    memoryFileMigrationHooks.beforePublish = async (pathToTarget) => {
      await writeJson(pathToTarget, TARGET_GRAPH)
    }

    await expect(migrate()).resolves.toBe('concurrent-target')

    expect(JSON.parse(await readFile(targetPath, 'utf8'))).toEqual(TARGET_GRAPH)
    expect(JSON.parse(await readFile(legacyPath, 'utf8'))).toEqual(SOURCE_GRAPH)
  })

  it('fails closed if a sibling hard-link unexpectedly reports a cross-device boundary', async () => {
    await writeJson(legacyPath, SOURCE_GRAPH)
    memoryFileMigrationHooks.hardLink = async () => {
      throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' })
    }

    await expect(migrate()).rejects.toMatchObject({ code: 'EXDEV' })

    expect(existsSync(targetPath)).toBe(false)
    expect(JSON.parse(await readFile(legacyPath, 'utf8'))).toEqual(SOURCE_GRAPH)
  })

  it('rejects source drift observed after reading without publishing captured bytes', async () => {
    await writeJson(legacyPath, SOURCE_GRAPH)
    memoryFileMigrationHooks.afterLegacyRead = async (sourcePath) => {
      await writeJson(sourcePath, TARGET_GRAPH)
    }

    await expect(migrate()).rejects.toThrow(/changed during capture/)

    expect(existsSync(targetPath)).toBe(false)
  })

  it('rejects source drift after capture but before the hard-link commit', async () => {
    await writeJson(legacyPath, SOURCE_GRAPH)
    memoryFileMigrationHooks.beforePublish = async () => {
      await writeJson(legacyPath, TARGET_GRAPH)
    }

    await expect(migrate()).rejects.toThrow(/changed before publication/)

    expect(existsSync(targetPath)).toBe(false)
  })

  it('removes its published link when source drift is detected immediately after commit', async () => {
    await writeJson(legacyPath, SOURCE_GRAPH)
    memoryFileMigrationHooks.afterPublish = async () => {
      await writeJson(legacyPath, TARGET_GRAPH)
    }

    await expect(migrate()).rejects.toThrow(/changed during publication/)

    expect(existsSync(targetPath)).toBe(false)
  })

  it('does not initialize empty memory when a legacy source appears after the absent baseline', async () => {
    memoryFileMigrationHooks.beforePublish = async () => {
      await writeJson(legacyPath, SOURCE_GRAPH)
    }

    await expect(migrate()).rejects.toThrow(/appeared before publication/)

    expect(existsSync(targetPath)).toBe(false)
  })

  it.runIf(process.platform !== 'win32')('rejects a symlink in the target ancestor chain', async () => {
    const outside = path.join(root, 'outside')
    await mkdir(outside)
    await symlink(outside, path.join(profileRoot, 'Data'))

    await expect(migrate()).rejects.toThrow(/ancestor must be a real directory/)

    expect(existsSync(path.join(outside, 'Mcp', 'memory.json'))).toBe(false)
  })

  it.runIf(process.platform !== 'win32')('rejects a symlink in the legacy ancestor chain', async () => {
    const outside = path.join(root, 'outside-legacy')
    await mkdir(outside)
    await symlink(outside, path.join(legacyRoot, 'config'))

    await expect(migrate()).rejects.toThrow(/source ancestor must be a real directory/)

    expect(existsSync(targetPath)).toBe(false)
  })

  it('reports success after commit even when migration staging cleanup fails', async () => {
    await writeJson(legacyPath, SOURCE_GRAPH)
    memoryFileMigrationHooks.removeStaging = async () => {
      throw new Error('cleanup denied')
    }

    await expect(migrate()).resolves.toBe('migrated')

    expect(JSON.parse(await readFile(targetPath, 'utf8'))).toEqual(SOURCE_GRAPH)
    expect((await readdir(path.dirname(targetPath))).some((name) => name.startsWith('.memory-migration-'))).toBe(true)
  })
})
