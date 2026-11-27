import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, cpSync, existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { signAsync } from '@electron/osx-sign'

import { getRunPaths, type RunPaths } from './paths'

export function macRuntimeExecutable(paths: RunPaths): string {
  return join(paths.installed, 'signed-runtime', 'Electron.app', 'Contents', 'MacOS', 'Electron')
}

export function macNativeFixtureExecutable(runDirectory: string | undefined, fallback: string): string {
  if (runDirectory === undefined) return fallback
  if (!runDirectory.trim()) throw new Error('Configured macOS run directory is empty')
  const executable = macRuntimeExecutable(getRunPaths(runDirectory))
  if (!existsSync(executable)) throw new Error('Prepared macOS runtime is missing')
  return executable
}

// UNUserNotificationCenter rejects the ad-hoc signed Electron download. Sign an isolated copy;
// never modify the developer's node_modules runtime or import a certificate into their login keychain.
export async function prepareMacRuntime(paths: RunPaths, targetRoot: string): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('macOS runtime preparation requires macOS')
  const executable = macRuntimeExecutable(paths)
  const runtimeRoot = join(paths.installed, 'signed-runtime')
  if (existsSync(runtimeRoot)) throw new Error('The isolated signed runtime already exists')
  const targetRequire = createRequire(join(targetRoot, 'package.json'))
  const electronPackage = targetRequire.resolve('electron/package.json')
  const source = join(dirname(electronPackage), 'dist', 'Electron.app')
  const app = join(runtimeRoot, 'Electron.app')
  mkdirSync(runtimeRoot, { recursive: true })
  let cleanupKeychain: (() => Promise<void>) | undefined
  try {
    let keychain: string | undefined
    if (process.env.CSC_LINK) {
      if (process.env.GITHUB_ACTIONS !== 'true')
        throw new Error('Certificate import is restricted to isolated CI runners')
      const builderRequire = createRequire(targetRequire.resolve('electron-builder'))
      const libRequire = createRequire(builderRequire.resolve('app-builder-lib'))
      const { createKeychain, removeKeychain } = builderRequire('app-builder-lib/out/codeSign/macCodeSign')
      const { TmpDir } = libRequire('temp-file')
      const temporaryDirectory = new TmpDir()
      const signingRoot = join(paths.private, 'mac-signing')
      mkdirSync(join(signingRoot, 'cache'), { recursive: true })
      const originalTemporaryRoot = process.env.APP_BUILDER_TMP_DIR
      const originalCache = process.env.ELECTRON_BUILDER_CACHE
      const keychains = execFileSync('security', ['list-keychains', '-d', 'user'], { encoding: 'utf8' })
        .split('\n')
        .map((line) => line.trim().replace(/^"|"$/g, ''))
        .filter(Boolean)
      process.env.APP_BUILDER_TMP_DIR = signingRoot
      process.env.ELECTRON_BUILDER_CACHE = join(signingRoot, 'cache')
      cleanupKeychain = async () => {
        try {
          execFileSync('security', ['list-keychains', '-d', 'user', '-s', ...keychains], { stdio: 'ignore' })
          if (keychain) await removeKeychain(keychain)
          await temporaryDirectory.cleanup()
        } finally {
          if (originalTemporaryRoot === undefined) delete process.env.APP_BUILDER_TMP_DIR
          else process.env.APP_BUILDER_TMP_DIR = originalTemporaryRoot
          if (originalCache === undefined) delete process.env.ELECTRON_BUILDER_CACHE
          else process.env.ELECTRON_BUILDER_CACHE = originalCache
          rmSync(signingRoot, { recursive: true, force: true })
        }
      }
      const imported = await createKeychain({
        tmpDir: temporaryDirectory,
        cscLink: process.env.CSC_LINK,
        cscKeyPassword: process.env.CSC_KEY_PASSWORD ?? '',
        currentDir: signingRoot
      }).catch(() => {
        throw new Error('macOS signing certificate import failed')
      })
      keychain = imported.keychainFile
    }
    const identities = execFileSync(
      'security',
      ['find-identity', '-v', '-p', 'codesigning', ...(keychain ? [keychain] : [])],
      { encoding: 'utf8' }
    )
    const candidates = [...identities.matchAll(/\b([A-Fa-f0-9]{40}) "(Developer ID Application: [^"]+)"/g)]
    const requested = process.env.CHERRY_E2E_MAC_SIGN_IDENTITY
    const matches = candidates.filter((match) => !requested || match[1] === requested || match[2] === requested)
    if (matches.length !== 1)
      throw new Error('Set CHERRY_E2E_MAC_SIGN_IDENTITY to one installed Developer ID Application identity')
    cpSync(source, app, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE })
    const workspaceId = createHash('sha256').update(realpathSync(targetRoot)).digest('hex').slice(0, 12)
    const name = `Cherry Studio E2E ${workspaceId}`
    const identifier = `com.cherrystudio.e2e.${workspaceId}`
    const bundleIdentities = [
      { path: join(app, 'Contents', 'Info.plist'), identifier, name, displayName: name },
      ...['', ' (Renderer)', ' (GPU)', ' (Plugin)'].map((suffix) => ({
        path: join(app, 'Contents', 'Frameworks', `Electron Helper${suffix}.app`, 'Contents', 'Info.plist'),
        identifier: `${identifier}.helper`,
        name: suffix ? `${name} Helper${suffix}` : name,
        displayName: `${name} Helper${suffix}`
      }))
    ]
    for (const bundle of bundleIdentities) {
      for (const [key, value] of Object.entries({
        CFBundleIdentifier: bundle.identifier,
        CFBundleName: bundle.name,
        CFBundleDisplayName: bundle.displayName
      })) {
        execFileSync('/usr/bin/plutil', ['-replace', key, '-string', value, bundle.path], { stdio: 'ignore' })
      }
    }
    await signAsync({
      app,
      identity: matches[0][1],
      keychain,
      platform: 'darwin',
      version: targetRequire(electronPackage).version,
      preAutoEntitlements: false,
      preEmbedProvisioningProfile: false,
      optionsForFile: () => ({ hardenedRuntime: false })
    })
    execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'ignore' })
    if (!existsSync(executable)) throw new Error('Signed Electron executable is missing')
    mkdirSync(paths.logs, { recursive: true })
    writeFileSync(
      join(paths.logs, 'mac-runtime-identity.json'),
      JSON.stringify({ executable, bundles: bundleIdentities }),
      {
        mode: 0o600
      }
    )
  } catch (error) {
    rmSync(runtimeRoot, { recursive: true, force: true })
    throw error
  } finally {
    await cleanupKeychain?.()
  }
}
