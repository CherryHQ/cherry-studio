import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test as base } from '@playwright/test'

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

export const test = base.extend<ElectronFixtures & { isolatedEnvironment: void }>({
  isolatedEnvironment: [
    async ({}, use) => {
      // Chromium's macOS singleton socket cannot fit under deeply nested report directories.
      const runtimeRoot = await mkdtemp(join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'cs-e2e-'))
      const paths = getRunPaths(runtimeRoot)
      const environment = {
        ...createProfileEnvironment(paths, 'authenticated'),
        CS_DEV_PROFILE_ROOT: join(paths.profiles, 'authenticated')
      }
      const previous = new Map<string, string | undefined>()
      for (const [key, value] of Object.entries(environment)) {
        if (value === process.env[key]) continue
        previous.set(key, process.env[key])
        process.env[key] = value
      }
      try {
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
    const electronApp = await electron.launch({
      args: ['.'],
      env,
      timeout: 60000
    })

    try {
      await use(electronApp)
    } finally {
      await electronApp.close()
    }
  },

  mainWindow: async ({ electronApp }, use) => {
    // Wait for the main window (title: "Cherry Studio", not "Quick Assistant")
    // On Mac, the app may create the QuickAssistant window with a different title
    let mainWindow: Page | undefined
    await expect
      .poll(
        async () => {
          for (const window of electronApp.windows()) {
            if ((await window.title()) === 'Cherry Studio') mainWindow = window
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
