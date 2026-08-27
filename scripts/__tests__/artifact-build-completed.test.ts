import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import artifactBuildCompleted, { normalizeArtifactFilePath } from '../artifact-build-completed'

const PRODUCT_NAME = 'Cherry Studio'
const VERSION = '2.0.9'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-artifact-name-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('normalizeArtifactFilePath', () => {
  it.each([
    ['windows', 'Cherry Studio-2.0.9-x64-setup.exe', 'Cherry-Studio-2.0.9-win-x64-setup.exe'],
    ['windows', 'Cherry Studio-2.0.9-arm64-portable.exe', 'Cherry-Studio-2.0.9-win-arm64-portable.exe'],
    ['mac', 'Cherry Studio-2.0.9-x64.dmg', 'Cherry-Studio-2.0.9-mac-x64.dmg'],
    ['mac', 'Cherry Studio-2.0.9-arm64.zip.blockmap', 'Cherry-Studio-2.0.9-mac-arm64.zip.blockmap'],
    ['linux', 'Cherry Studio-2.0.9-x86_64.AppImage', 'Cherry-Studio-2.0.9-linux-x64.AppImage'],
    ['linux', 'Cherry Studio-2.0.9-amd64.deb', 'Cherry-Studio-2.0.9-linux-x64.deb'],
    ['linux', 'Cherry Studio-2.0.9-aarch64.rpm', 'Cherry-Studio-2.0.9-linux-arm64.rpm']
  ])('normalizes the %s release asset %s', (platform, source, expected) => {
    expect(normalizeArtifactFilePath(path.join('dist', source), PRODUCT_NAME, VERSION, platform)).toBe(
      path.join('dist', expected)
    )
  })

  it('is idempotent for an already normalized asset', () => {
    const file = path.join('dist', 'Cherry-Studio-2.0.9-linux-x64.AppImage')
    expect(normalizeArtifactFilePath(file, PRODUCT_NAME, VERSION, 'linux')).toBe(file)
  })

  it.each(['latest.yml', 'latest-linux.yml', 'release-history.json', 'other-product-2.0.9-x64.zip'])(
    'does not add a platform prefix to %s',
    (fileName) => {
      const file = path.join('dist', fileName)
      expect(normalizeArtifactFilePath(file, PRODUCT_NAME, VERSION, 'linux')).toBe(file)
    }
  )
})

describe('artifactBuildCompleted', () => {
  it('renames the file and exposes its final path to later publisher hooks', () => {
    const directory = temporaryDirectory()
    const source = path.join(directory, 'Cherry Studio-2.0.9-x86_64.AppImage')
    const expected = path.join(directory, 'Cherry-Studio-2.0.9-linux-x64.AppImage')
    fs.writeFileSync(source, 'artifact')
    const buildResult = {
      file: source,
      safeArtifactName: 'Cherry-Studio-2.0.9-x86_64.AppImage',
      packager: {
        appInfo: { productName: PRODUCT_NAME, version: VERSION },
        platform: { name: 'linux' }
      }
    }

    artifactBuildCompleted(buildResult)

    expect(buildResult.file).toBe(expected)
    expect(buildResult.safeArtifactName).toBe('Cherry-Studio-2.0.9-linux-x64.AppImage')
    expect(fs.existsSync(source)).toBe(false)
    expect(fs.readFileSync(expected, 'utf8')).toBe('artifact')
  })
})
