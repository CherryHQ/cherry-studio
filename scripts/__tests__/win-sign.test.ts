import type * as childProcessModule from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// CJS captures execSync when loaded; stub it before requiring the signing hook.
const require = createRequire(import.meta.url)
const childProcess = require('child_process') as typeof childProcessModule
const execSync = vi.spyOn(childProcess, 'execSync')
const sign = require('../win-sign').default as (configuration: { path: string }) => Promise<void>
const prebuilds = path.resolve(import.meta.dirname, '../../node_modules/selection-hook/prebuilds')
let directory: string

function fixture(platform: string, name = 'node_modules/example/native.node'): string {
  const file = path.join(directory, name)
  mkdirSync(path.dirname(file), { recursive: true })
  copyFileSync(path.join(prebuilds, platform, 'selection-hook.node'), file)
  return file
}

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'cherry-win-sign-'))
  vi.stubEnv('WIN_SIGN', 'true')
  vi.stubEnv('CHERRY_CERT_PATH', 'test-cert')
  vi.stubEnv('CHERRY_CERT_KEY', 'test-key')
  vi.stubEnv('CHERRY_CERT_CSP', 'test-csp')
  vi.stubEnv('WIN_SIGN_TIMESTAMP_URLS', 'https://timestamp.test')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(Atomics, 'wait').mockReturnValue('timed-out')
  execSync.mockImplementation((command: string) => {
    const file = command.match(/"([^"]+)"$/)?.[1]
    if (!file) throw new Error('Missing signing target')
    writeFileSync(`${file}.signed`, readFileSync(file))
    return Buffer.alloc(0)
  })
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.mocked(console.log).mockRestore()
  vi.mocked(console.warn).mockRestore()
  vi.mocked(console.error).mockRestore()
  vi.mocked(Atomics.wait).mockRestore()
  execSync.mockReset()
})

afterAll(() => execSync.mockRestore())

describe('Windows signing format policy', () => {
  it.each(['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'])(
    'keeps the %s prebuild without attempting Windows signing',
    async (platform) => {
      const file = fixture(platform)
      const original = readFileSync(file)
      execSync.mockImplementation(() => {
        throw new Error('Foreign binary reached SignTool')
      })

      await expect(sign({ path: file })).resolves.toBeUndefined()
      expect(readFileSync(file)).toEqual(original)
      expect(existsSync(`${file}.signed`)).toBe(false)
    }
  )

  it.each(['win32-x64', 'win32-arm64'])('signs the actual %s prebuild', async (platform) => {
    const file = fixture(platform)
    await sign({ path: file })
    expect(readFileSync(`${file}.signed`)).toEqual(readFileSync(file))
  })

  it.each(['.dll', '.so', '.dylib', '.NODE'])('also skips foreign dependency libraries named %s', async (extension) => {
    const file = fixture('linux-x64', `node_modules/another-library/native${extension}`)
    execSync.mockImplementation(() => {
      throw new Error('Foreign binary reached SignTool')
    })
    await expect(sign({ path: file })).resolves.toBeUndefined()
  })

  it.each(['app.exe', 'setup.exe', 'node_modules/example/helper.exe', 'resources/native.node'])(
    'rejects a foreign binary at a required Windows target: %s',
    async (name) => {
      const file = fixture('linux-x64', name)
      await expect(sign({ path: file })).rejects.toThrow('Expected a Windows PE binary')
      expect(existsSync(`${file}.signed`)).toBe(false)
    }
  )

  it.each(['app.exe', 'node_modules/example/native.dll'])('signs Windows PE files named %s', async (name) => {
    const file = fixture('win32-x64', name)
    await sign({ path: file })
    expect(readFileSync(`${file}.signed`)).toEqual(readFileSync(file))
  })

  it.each(['empty', 'truncated', 'unknown', 'bad-offset', 'bad-signature'])(
    'rejects a %s native binary before signing',
    async (kind) => {
      const file = fixture('win32-x64')
      const binary = readFileSync(file)
      if (kind === 'bad-offset') binary.writeUInt32LE(0xffffffff, 0x3c)
      if (kind === 'bad-signature') binary.writeUInt32LE(0, binary.readUInt32LE(0x3c))
      writeFileSync(
        file,
        kind === 'empty'
          ? Buffer.alloc(0)
          : kind === 'truncated'
            ? binary.subarray(0, 63)
            : kind === 'unknown'
              ? Buffer.alloc(64)
              : binary
      )

      await expect(sign({ path: file })).rejects.toThrow(
        /Truncated native binary|Invalid or unsupported Windows PE binary/
      )
      expect(existsSync(`${file}.signed`)).toBe(false)
    }
  )

  it('propagates unreadable-file errors', async () => {
    await expect(sign({ path: path.join(directory, 'missing.node') })).rejects.toThrow('ENOENT')
  })

  it('does not swallow a Windows signing failure after retries', async () => {
    const file = fixture('win32-x64')
    execSync.mockImplementation(() => {
      throw new Error('Certificate signing failed')
    })
    await expect(sign({ path: file })).rejects.toThrow('Certificate signing failed')
    expect(existsSync(`${file}.signed`)).toBe(false)
  })

  it('recovers from a transient signing failure', async () => {
    const file = fixture('win32-x64')
    execSync.mockImplementationOnce(() => {
      throw new Error('Temporary timestamp failure')
    })
    await sign({ path: file })
    expect(readFileSync(`${file}.signed`)).toEqual(readFileSync(file))
  })

  it.each(['msi', 'appx'])(
    'leaves %s validation to SignTool instead of skipping non-PE installers',
    async (extension) => {
      const file = path.join(directory, `setup.${extension}`)
      writeFileSync(file, 'installer container')
      await sign({ path: file })
      expect(readFileSync(`${file}.signed`, 'utf8')).toBe('installer container')
      execSync.mockImplementation(() => {
        throw new Error('Invalid installer')
      })
      await expect(sign({ path: file })).rejects.toThrow('Invalid installer')
    }
  )

  it('does not require files or credentials when signing is disabled', async () => {
    vi.stubEnv('WIN_SIGN', '')
    await expect(sign({ path: path.join(directory, 'missing.node') })).resolves.toBeUndefined()
  })
})
