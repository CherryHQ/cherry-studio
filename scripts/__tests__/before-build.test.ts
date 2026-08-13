import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import beforeBuild, { clearBetterSqlite3ElectronMetadata } from '../before-build'

const tmpDirs: string[] = []

function makeAppDir(): { appDir: string; metadataPath: string } {
  const appDir = mkdtempSync(path.join(os.tmpdir(), 'before-build-'))
  tmpDirs.push(appDir)
  const metadataPath = path.join(appDir, 'node_modules', 'better-sqlite3', 'build', 'Release', '.forge-meta')
  mkdirSync(path.dirname(metadataPath), { recursive: true })
  writeFileSync(metadataPath, 'arm64--145', 'utf8')
  return { appDir, metadataPath }
}

afterEach(() => {
  for (const directory of tmpDirs) rmSync(directory, { recursive: true, force: true })
  tmpDirs.length = 0
})

describe('better-sqlite3 Electron rebuild metadata', () => {
  it('removes the stale marker without deleting the compiled addon', () => {
    const { appDir, metadataPath } = makeAppDir()
    const addonPath = path.join(path.dirname(metadataPath), 'better_sqlite3.node')
    writeFileSync(addonPath, 'native-addon', 'utf8')

    expect(clearBetterSqlite3ElectronMetadata(appDir)).toBe(metadataPath)
    expect(existsSync(metadataPath)).toBe(false)
    expect(existsSync(addonPath)).toBe(true)
  })

  it('lets electron-builder continue with its target-aware dependency rebuild', async () => {
    const { appDir, metadataPath } = makeAppDir()

    await expect(beforeBuild({ appDir })).resolves.toBe(true)
    expect(existsSync(metadataPath)).toBe(false)
  })
})
