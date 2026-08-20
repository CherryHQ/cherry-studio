import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { assertDshAsarBoundary } from '../after-pack'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories) fs.rmSync(directory, { recursive: true, force: true })
  temporaryDirectories.length = 0
})

function makeAppOutDir(): string {
  const appOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-boundary-'))
  temporaryDirectories.push(appOutDir)
  return appOutDir
}

describe('assertDshAsarBoundary', () => {
  it('rejects foreign native prebuilds when the target is known', () => {
    const appOutDir = makeAppOutDir()
    const nativePath = path.join(
      appOutDir,
      'resources',
      'app.asar.unpacked',
      'node_modules',
      'native-package',
      'prebuilds',
      'linux-arm64',
      'binding.node'
    )
    fs.mkdirSync(path.dirname(nativePath), { recursive: true })
    fs.writeFileSync(nativePath, '')

    expect(() => assertDshAsarBoundary(appOutDir, 'win32', 'x64')).toThrow(/Foreign native files remain unpacked/)
  })
})
