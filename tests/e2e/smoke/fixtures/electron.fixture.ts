import { constants } from 'node:fs'
import { access, copyFile, link, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test as base } from '@playwright/test'

import { claudeCodeBinaryManifest } from '../../../../scripts/claudeCodeBinaryManifest'
import { createProfileEnvironment } from '../../../../scripts/e2e/regression/lifecycle'
import { getRunPaths } from '../../../../scripts/e2e/regression/paths'

/**
 * Custom fixtures for Electron e2e testing.
 * Provides electronApp and mainWindow to all tests.
 */
export type ElectronFixtures = {
  electronApp: ElectronApplication
  mainWindow: Page
}

const claudeRuntimes = new Map<string, ReturnType<typeof resolveClaudeRuntime>>()

function resolveClaudeRuntime(appRoot: string) {
  const manifest = claudeCodeBinaryManifest(appRoot)
  const require = createRequire(join(appRoot, 'package.json'))
  const sdkRequire = createRequire(require.resolve('@anthropic-ai/claude-agent-sdk'))
  const isMusl =
    process.platform === 'linux' &&
    !(process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime
  const target = `${process.platform}-${process.arch}${isMusl ? '-musl' : ''}`
  const pkg = manifest.packages[target]
  if (!pkg) return undefined

  const packageFile = sdkRequire.resolve(`${pkg.name}/package.json`)
  if (sdkRequire(packageFile).version !== manifest.version) {
    throw new Error(`Claude runtime package ${pkg.name} must match SDK version ${manifest.version}`)
  }
  const executable = process.platform === 'win32' ? 'claude.exe' : 'claude'
  return { packageDir: dirname(packageFile), executable, target, version: manifest.version, integrity: pkg.integrity }
}

export async function launchSmokeElectron(options: NonNullable<Parameters<typeof electron.launch>[0]>) {
  const profile = (options.env ?? process.env).CS_DEV_PROFILE_ROOT
  if (!profile) throw new Error('Smoke Electron requires an isolated CS_DEV_PROFILE_ROOT')

  const appRoot = resolve(options.cwd ?? process.cwd())
  if (!claudeRuntimes.has(appRoot)) claudeRuntimes.set(appRoot, resolveClaudeRuntime(appRoot))
  const runtime = claudeRuntimes.get(appRoot)
  if (runtime) {
    // Use the same install layout as ClaudeCodeBinaryService so startup can reuse the pnpm package.
    const directory = join(profile, 'userData', 'Toolchain', 'claude-agent-sdk', runtime.version, runtime.target)
    const source = join(runtime.packageDir, runtime.executable)
    const executable = join(directory, runtime.executable)
    await mkdir(directory, { recursive: true })
    try {
      await link(source, executable)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') {
        // The temporary profile may be on a different volume from node_modules.
        await copyFile(source, executable, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL).catch((copyError) => {
          if ((copyError as NodeJS.ErrnoException).code !== 'EEXIST') throw copyError
        })
      }
    }
    const { size } = await stat(executable)
    if (!size || size !== (await stat(source)).size) throw new Error('Incomplete Claude runtime in smoke profile')
    await access(executable, process.platform === 'win32' ? constants.R_OK : constants.X_OK)
    await copyFile(join(runtime.packageDir, 'LICENSE.md'), join(directory, 'LICENSE.md'))
    await writeFile(join(directory, 'installed.json'), JSON.stringify({ integrity: runtime.integrity, size }))
  }
  return electron.launch(options)
}

export async function closeElectronApp(app: ElectronApplication): Promise<void> {
  const child = app.process()
  let forced = false
  const deadline = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return
    forced = true
    child.kill('SIGKILL')
  }, 15_000)
  try {
    await app.close()
    if (forced) throw new Error('Owned Electron did not quit within 15 seconds; cleanup terminated it')
  } finally {
    clearTimeout(deadline)
  }
}

export const test = base.extend<ElectronFixtures & { isolatedEnvironment: void }>({
  isolatedEnvironment: [
    async ({}, use) => {
      // Chromium's macOS singleton socket cannot fit under deeply nested report directories.
      const runtimeRoot = await mkdtemp(join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'cs-e2e-'))
      const previous = new Map<string, string | undefined>()
      try {
        const paths = getRunPaths(runtimeRoot)
        const environment = {
          ...createProfileEnvironment(paths, 'authenticated'),
          CS_DEV_PROFILE_ROOT: join(paths.profiles, 'authenticated')
        }
        for (const [key, value] of Object.entries(environment)) {
          if (value === process.env[key]) continue
          previous.set(key, process.env[key])
          process.env[key] = value
        }
        await use()
      } finally {
        for (const [key, value] of previous) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
        await rm(runtimeRoot, { recursive: true, force: true })
      }
    },
    { auto: true }
  ],
  electronApp: async ({}, use) => {
    const env = { ...process.env, NODE_ENV: 'development' }
    Reflect.deleteProperty(env, 'ELECTRON_RENDERER_URL')
    const electronApp = await launchSmokeElectron({
      args: ['.'],
      env,
      timeout: 60000
    })

    try {
      await use(electronApp)
    } finally {
      await closeElectronApp(electronApp)
    }
  },

  mainWindow: async ({ electronApp }, use) => {
    // Pooled windows can initially share the app title; identify the main renderer by its entry path.
    let mainWindow: Page | undefined
    await expect
      .poll(
        async () => {
          for (const window of electronApp.windows()) {
            if (/\/windows\/main\/index\.html(?:[?#]|$)/.test(window.url())) mainWindow = window
          }
          return Boolean(mainWindow)
        },
        { timeout: 60000 }
      )
      .toBe(true)
    if (!mainWindow) throw new Error('Main window did not open')

    // Wait for React app to mount
    await mainWindow.waitForSelector('#root', { state: 'attached', timeout: 60000 })

    // Wait for initial content to load
    await mainWindow.waitForLoadState('domcontentloaded')

    await use(mainWindow)
  }
})

export { expect } from '@playwright/test'
