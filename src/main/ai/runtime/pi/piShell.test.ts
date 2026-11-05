import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { serializeError } from '@main/ai/utils/serializeError'
import type * as CommandResolverModule from '@main/utils/commandResolver'
import { autoDiscoverGitBash } from '@main/utils/commandResolver'

import { resolvePiShellPath } from './piShell'

vi.mock('@main/utils/commandResolver', async (importOriginal) => ({
  ...(await importOriginal<typeof CommandResolverModule>()),
  autoDiscoverGitBash: vi.fn()
}))

function onPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { ...descriptor, value: platform })
  try {
    return run()
  } finally {
    Object.defineProperty(process, 'platform', descriptor)
  }
}

function rejectedShell(): Error {
  try {
    resolvePiShellPath()
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    return error as Error
  }
  return expect.fail('An invalid configured shell must stop startup')
}

describe('resolvePiShellPath', () => {
  let fixtureDir: string
  let settingsPath: string
  let discoveredBash: string

  beforeEach(() => {
    fixtureDir = fs.mkdtempSync(path.join(tmpdir(), 'pi-shell-'))
    settingsPath = path.join(fixtureDir, 'settings.json')
    discoveredBash = path.join(fixtureDir, 'bash.exe')
    fs.writeFileSync(discoveredBash, '')
    vi.spyOn(application, 'getPath').mockImplementation((key) => {
      expect(key).toBe('external.pi.settings_file')
      return settingsPath
    })
    vi.mocked(autoDiscoverGitBash).mockReset().mockReturnValue(discoveredBash)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(fixtureDir, { recursive: true, force: true })
  })

  it.each([
    ['powershell.exe', true],
    ['sh.exe', true],
    ['git-bash.exe', true],
    ['missing.exe', false],
    ['missing/bash.exe', false]
  ] as const)(
    'rejects configured %s with recovery metadata instead of discovering another shell',
    (filename, exists) => {
      const configured = `${fixtureDir}${path.sep}.${path.sep}${filename}`
      if (exists) fs.writeFileSync(path.join(fixtureDir, filename), '')
      fs.writeFileSync(settingsPath, JSON.stringify({ shellPath: `  ${configured} \n` }))

      onPlatform('win32', () => {
        const error = rejectedShell()
        expect(error.name).toBe('Error')
        expect(error.message).toBe(`Configured Pi shellPath is unavailable or is not bash.exe: ${configured}`)
        expect(error.stack).toContain(error.message)
        expect(error).toMatchObject({
          i18nKey: 'pi_shell_configuration_invalid',
          detailI18nKey: 'pi_shell_configuration_invalid_detail',
          detailI18nValues: { shellPath: configured, settingsPath }
        })
        expect(Object.keys(error).sort()).toEqual(['detailI18nKey', 'detailI18nValues', 'i18nKey'])
        expect(autoDiscoverGitBash).not.toHaveBeenCalled()
      })
    }
  )

  it.each(['bash.exe', 'BASH.EXE'])('keeps a valid configured %s ahead of discovery', (filename) => {
    const configured = path.join(fixtureDir, filename)
    fs.writeFileSync(configured, '')
    fs.writeFileSync(settingsPath, JSON.stringify({ shellPath: configured }))

    onPlatform('win32', () => {
      expect(resolvePiShellPath()).toBe(configured)
      expect(autoDiscoverGitBash).not.toHaveBeenCalled()
    })
  })

  it.each(['missing', 'malformed', 'empty', 'absent', 'whitespace', 'null', 'number', 'object'])(
    'uses discovery when settings are %s',
    (scenario) => {
      const settings: Record<string, string> = {
        malformed: '{',
        empty: '',
        absent: '{}',
        whitespace: JSON.stringify({ shellPath: ' \n ' }),
        null: JSON.stringify({ shellPath: null }),
        number: JSON.stringify({ shellPath: 42 }),
        object: JSON.stringify({ shellPath: {} })
      }
      if (scenario !== 'missing') fs.writeFileSync(settingsPath, settings[scenario])

      onPlatform('win32', () => {
        expect(resolvePiShellPath()).toBe(discoveredBash)
      })
    }
  )

  it('returns undefined when an absent field has no discovery result', () => {
    fs.writeFileSync(settingsPath, '{}')
    vi.mocked(autoDiscoverGitBash).mockReturnValue(null)
    onPlatform('win32', () => expect(resolvePiShellPath()).toBeUndefined())
  })

  it('reads corrected and removed settings on the next attempt', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ shellPath: path.join(fixtureDir, 'missing.exe') }))
    onPlatform('win32', () => {
      rejectedShell()
      fs.writeFileSync(settingsPath, JSON.stringify({ shellPath: discoveredBash }))
      expect(resolvePiShellPath()).toBe(discoveredBash)
      fs.writeFileSync(settingsPath, '{}')
      vi.mocked(autoDiscoverGitBash).mockReturnValue(null)
      expect(resolvePiShellPath()).toBeUndefined()
    })
  })

  it('retains the real rejection message and recovery fields through serialization', () => {
    const configured = path.join(fixtureDir, 'missing.exe')
    fs.writeFileSync(settingsPath, JSON.stringify({ shellPath: configured }))
    const error = onPlatform('win32', rejectedShell)

    expect(serializeError(error)).toMatchObject({
      name: 'Error',
      message: `Configured Pi shellPath is unavailable or is not bash.exe: ${configured}`,
      stack: error.stack,
      i18nKey: 'pi_shell_configuration_invalid',
      detailI18nKey: 'pi_shell_configuration_invalid_detail',
      detailI18nValues: { shellPath: configured, settingsPath }
    })
  })

  it.each(['darwin', 'linux'] as const)('does not read settings or discover shells on %s', (platform) => {
    const readSettings = vi.spyOn(fs, 'readFileSync')
    onPlatform(platform, () => expect(resolvePiShellPath()).toBeUndefined())
    expect(readSettings).not.toHaveBeenCalled()
    expect(application.getPath).not.toHaveBeenCalled()
    expect(autoDiscoverGitBash).not.toHaveBeenCalled()
  })
})
