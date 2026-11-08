import type * as childProcess from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { exec, sign } = vi.hoisted(() => ({ exec: vi.fn(), sign: vi.fn() }))
vi.mock('node:child_process', () => ({ execFileSync: exec }))
vi.mock('@electron/osx-sign', () => ({ signAsync: sign }))

import { macNativeFixtureExecutable, macRuntimeExecutable, prepareMacRuntime } from '../macRuntime'
import { getRunPaths } from '../paths'

let directory: string
let target: string
let source: string
const identity = 'Developer ID Application: Regression Fixture (TESTTEAM)'
const helperSuffixes = ['', ' (Renderer)', ' (GPU)', ' (Plugin)']
const hostPlatform = process.platform
beforeEach(() => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  vi.stubEnv('CSC_LINK', '')
  vi.stubEnv('CHERRY_E2E_MAC_SIGN_IDENTITY', identity)
  directory = mkdtempSync(join(tmpdir(), 'cherry-mac-runtime-'))
  target = join(directory, 'target')
  const packageRoot = join(target, 'node_modules', 'electron')
  source = join(packageRoot, 'dist', 'Electron.app')
  mkdirSync(join(source, 'Contents', 'MacOS'), { recursive: true })
  writeFileSync(join(target, 'package.json'), '{}')
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: 'electron', version: '45.2.2' }))
  writeFileSync(join(source, 'Contents', 'MacOS', 'Electron'), 'original runtime')
  writeFileSync(
    join(source, 'Contents', 'Info.plist'),
    '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.github.Electron</string><key>CFBundleName</key><string>Electron</string><key>CFBundleDisplayName</key><string>Electron</string></dict></plist>'
  )
  for (const suffix of helperSuffixes) {
    const helper = join(source, 'Contents', 'Frameworks', `Electron Helper${suffix}.app`, 'Contents')
    mkdirSync(join(helper, 'MacOS'), { recursive: true })
    writeFileSync(join(helper, 'MacOS', `Electron Helper${suffix}`), 'original helper')
    writeFileSync(
      join(helper, 'Info.plist'),
      `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.github.Electron.helper</string><key>CFBundleName</key><string>Electron Helper${suffix}</string></dict></plist>`
    )
  }
  symlinkSync('MacOS', join(source, 'Contents', 'Current'))
  exec.mockImplementation((command: string) =>
    command === 'security' ? `1) ${'A'.repeat(40)} "${identity}"\n 1 valid identities found` : ''
  )
  sign.mockResolvedValue(undefined)
})
afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
  vi.resetAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('isolated signed macOS runtime', () => {
  it('selects the configured run copy without using the original Electron download', () => {
    const paths = getRunPaths(join(directory, 'configured-run'))
    const executable = macRuntimeExecutable(paths)
    mkdirSync(dirname(executable), { recursive: true })
    writeFileSync(executable, 'prepared owned runtime')
    const original = join(source, 'Contents', 'MacOS', 'Electron')
    expect(macNativeFixtureExecutable(paths.root, original)).toBe(executable)
    expect(readFileSync(macNativeFixtureExecutable(paths.root, original), 'utf8')).toBe('prepared owned runtime')
    expect(macNativeFixtureExecutable(undefined, original)).toBe(original)
  })

  it('refuses a configured run without its prepared runtime instead of falling back to a working download', () => {
    const original = join(source, 'Contents', 'MacOS', 'Electron')
    expect(existsSync(original)).toBe(true)
    expect(() => macNativeFixtureExecutable(join(directory, 'missing-run'), original)).toThrow(
      'Prepared macOS runtime is missing'
    )
    expect(() => macNativeFixtureExecutable('', original)).toThrow('Configured macOS run directory is empty')
  })

  it.skipIf(hostPlatform !== 'darwin')(
    'keeps a distinct workspace identity across profile and run copies',
    async () => {
      const { execFileSync } = await vi.importActual<typeof childProcess>('node:child_process')
      exec.mockImplementation((command: string, args: string[]) =>
        command === '/usr/bin/plutil'
          ? execFileSync(command, args, { encoding: 'utf8' })
          : command === 'security'
            ? `1) ${'A'.repeat(40)} "${identity}"\n 1 valid identities found`
            : ''
      )
      const originalInfo = readFileSync(join(source, 'Contents', 'Info.plist'), 'utf8')
      const helperSources = helperSuffixes.map((suffix) =>
        join(source, 'Contents', 'Frameworks', `Electron Helper${suffix}.app`, 'Contents', 'Info.plist')
      )
      const originalHelpers = helperSources.map((path) => readFileSync(path, 'utf8'))
      const signedIdentities: Array<{ id: string; name: string }> = []
      sign.mockImplementation(async ({ app }: { app: string }) => {
        const read = (plist: string, key: string) =>
          execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim()
        const main = join(app, 'Contents', 'Info.plist')
        const id = read(main, 'CFBundleIdentifier')
        const name = read(main, 'CFBundleDisplayName')
        expect(id).toMatch(/^com\.cherrystudio\.e2e\.[a-f0-9]{12}$/)
        expect(name).toMatch(/^Cherry Studio E2E [a-f0-9]{12}$/)
        for (const suffix of helperSuffixes) {
          const helper = join(app, 'Contents', 'Frameworks', `Electron Helper${suffix}.app`, 'Contents')
          const plist = join(helper, 'Info.plist')
          expect(read(plist, 'CFBundleIdentifier')).toBe(`${id}.helper`)
          expect(read(plist, 'CFBundleName')).toBe(suffix ? `${name} Helper${suffix}` : name)
          expect(read(plist, 'CFBundleDisplayName')).toBe(`${name} Helper${suffix}`)
          expect(readFileSync(join(helper, 'MacOS', `Electron Helper${suffix}`), 'utf8')).toBe('original helper')
        }
        signedIdentities.push({ id, name })
      })
      const runs = [getRunPaths(join(directory, 'run-a')), getRunPaths(join(directory, 'run-b'))]
      for (const paths of runs) await prepareMacRuntime(paths, target)
      const otherTarget = join(directory, 'other-target')
      mkdirSync(otherTarget)
      writeFileSync(join(otherTarget, 'package.json'), '{}')
      symlinkSync(join(target, 'node_modules'), join(otherTarget, 'node_modules'))
      const otherRun = getRunPaths(join(directory, 'other-run'))
      await prepareMacRuntime(otherRun, otherTarget)
      const readIdentity = (paths: ReturnType<typeof getRunPaths>, key: string) =>
        execFileSync(
          '/usr/bin/plutil',
          ['-extract', key, 'raw', '-o', '-', join(dirname(dirname(macRuntimeExecutable(paths))), 'Info.plist')],
          { encoding: 'utf8' }
        ).trim()
      const firstId = readIdentity(runs[0], 'CFBundleIdentifier')
      expect(firstId).not.toBe('com.github.Electron')
      expect(readIdentity(runs[1], 'CFBundleIdentifier')).toBe(firstId)
      expect(readIdentity(otherRun, 'CFBundleIdentifier')).not.toBe(firstId)
      const firstName = readIdentity(runs[0], 'CFBundleName')
      expect(firstName).not.toBe('Electron')
      expect(readIdentity(otherRun, 'CFBundleName')).not.toBe(firstName)
      expect(readFileSync(join(source, 'Contents', 'Info.plist'), 'utf8')).toBe(originalInfo)
      expect(helperSources.map((path) => readFileSync(path, 'utf8'))).toEqual(originalHelpers)
      expect(signedIdentities[1]).toEqual(signedIdentities[0])
      expect(signedIdentities[2].id).not.toBe(signedIdentities[0].id)
      expect(signedIdentities[2].name).not.toBe(signedIdentities[0].name)
    }
  )

  it('preserves the original runtime and relative framework links while signing the run copy', async () => {
    const paths = getRunPaths(join(directory, 'run'))
    sign.mockImplementation(async ({ app }: { app: string }) => {
      expect(readlinkSync(join(app, 'Contents', 'Current'))).toBe('MacOS')
      writeFileSync(join(app, 'Contents', 'MacOS', 'Electron'), 'signed runtime')
    })
    await prepareMacRuntime(paths, target)
    expect(readFileSync(macRuntimeExecutable(paths), 'utf8')).toBe('signed runtime')
    expect(readFileSync(join(source, 'Contents', 'MacOS', 'Electron'), 'utf8')).toBe('original runtime')
  })

  it('removes an incomplete runtime after signing fails without deleting the source', async () => {
    const paths = getRunPaths(join(directory, 'run'))
    sign.mockRejectedValue(new Error('Signing rejected'))
    await expect(prepareMacRuntime(paths, target)).rejects.toThrow('Signing rejected')
    expect(existsSync(dirname(dirname(dirname(macRuntimeExecutable(paths)))))).toBe(false)
    expect(readFileSync(join(source, 'Contents', 'MacOS', 'Electron'), 'utf8')).toBe('original runtime')
  })

  it('rejects certificate import on a developer machine before copying or signing anything', async () => {
    vi.stubEnv('CSC_LINK', 'private-certificate')
    vi.stubEnv('GITHUB_ACTIONS', 'false')
    const paths = getRunPaths(join(directory, 'run'))
    await expect(prepareMacRuntime(paths, target)).rejects.toThrow('restricted to isolated CI runners')
    expect(existsSync(macRuntimeExecutable(paths))).toBe(false)
    expect(readFileSync(join(source, 'Contents', 'MacOS', 'Electron'), 'utf8')).toBe('original runtime')
  })
})
