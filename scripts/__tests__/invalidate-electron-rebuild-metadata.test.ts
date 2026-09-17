import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { invalidateElectronRebuildMetadata } from '../invalidate-electron-rebuild-metadata'

const temporaryDirectories: string[] = []

function temporaryModuleDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-native-rebuild-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('invalidateElectronRebuildMetadata', () => {
  it('removes the stale Electron marker without removing the native binary', () => {
    const moduleDirectory = temporaryModuleDirectory()
    const releaseDirectory = path.join(moduleDirectory, 'build', 'Release')
    const metadataPath = path.join(releaseDirectory, '.forge-meta')
    const binaryPath = path.join(releaseDirectory, 'better_sqlite3.node')
    fs.mkdirSync(releaseDirectory, { recursive: true })
    fs.writeFileSync(metadataPath, 'arm64--145')
    fs.writeFileSync(binaryPath, 'node binary')

    invalidateElectronRebuildMetadata(moduleDirectory)

    expect(fs.existsSync(metadataPath)).toBe(false)
    expect(fs.readFileSync(binaryPath, 'utf8')).toBe('node binary')
  })

  it('does nothing when Electron has not written a marker', () => {
    expect(() => invalidateElectronRebuildMetadata(temporaryModuleDirectory())).not.toThrow()
  })
})
