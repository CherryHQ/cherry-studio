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
  it('accepts an unpacked tree without DSH packages', () => {
    expect(() => assertDshAsarBoundary(makeAppOutDir())).not.toThrow()
  })

  it.each(['@deepseek-ai/dsh-agent', '@cherrystudio/dsh-bridge'])(
    'rejects an unpacked DSH package: %s',
    (packageName) => {
      const appOutDir = makeAppOutDir()
      const packagePath = path.join(
        appOutDir,
        'resources',
        'app.asar.unpacked',
        'node_modules',
        ...packageName.split('/')
      )
      fs.mkdirSync(packagePath, { recursive: true })

      expect(() => assertDshAsarBoundary(appOutDir)).toThrow(/DSH dependencies must remain in app\.asar/)
    }
  )

  it('checks the macOS Contents/Resources layout', () => {
    const appOutDir = makeAppOutDir()
    const packagePath = path.join(
      appOutDir,
      'Contents',
      'Resources',
      'app.asar.unpacked',
      'node_modules',
      '@deepseek-ai',
      'dsh-agent'
    )
    fs.mkdirSync(packagePath, { recursive: true })

    expect(() => assertDshAsarBoundary(appOutDir)).toThrow(/DSH dependencies must remain in app\.asar/)
  })

  it('finds DSH packages under a nested node_modules layout', () => {
    const appOutDir = makeAppOutDir()
    const packagePath = path.join(
      appOutDir,
      'resources',
      'app.asar.unpacked',
      'node_modules',
      '.pnpm',
      'dsh-package',
      'node_modules',
      '@deepseek-ai',
      'dsh-agent'
    )
    fs.mkdirSync(packagePath, { recursive: true })

    expect(() => assertDshAsarBoundary(appOutDir)).toThrow(/DSH dependencies must remain in app\.asar/)
  })

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

  it('rejects DSH native packages that escaped the asar filter', () => {
    const appOutDir = makeAppOutDir()
    const packagePath = path.join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty')
    fs.mkdirSync(packagePath, { recursive: true })

    expect(() => assertDshAsarBoundary(appOutDir, undefined, undefined, new Set(['node-pty']))).toThrow(
      /DSH dependencies must remain in app\.asar/
    )
  })
})
