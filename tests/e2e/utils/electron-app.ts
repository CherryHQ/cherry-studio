import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from '@playwright/test'
import * as path from 'path'

/**
 * Application context returned by launchApp
 */
export interface AppContext {
  electronApp: ElectronApplication
  mainWindow: Page
}

/**
 * Launch the Electron application for testing.
 * This is a standalone utility that can be used outside of fixtures.
 */
export async function launchApp(): Promise<AppContext> {
  // Launch Electron app from project root
  const electronApp = await electron.launch({
    args: ['.'],
    cwd: path.resolve(__dirname, '../../../'),
    env: {
      ...process.env,
      NODE_ENV: 'development'
    },
    timeout: 30000
  })

  // Wait for the main window
  const mainWindow = await electronApp.firstWindow()

  // Wait for React app to mount
  await mainWindow.waitForSelector('#root', { state: 'attached', timeout: 30000 })

  // Wait for DOM content to be loaded
  await mainWindow.waitForLoadState('domcontentloaded')

  return { electronApp, mainWindow }
}

/**
 * Close the Electron application.
 */
export async function closeApp(electronApp: ElectronApplication): Promise<void> {
  await electronApp.close()
}

/**
 * Evaluate code in the main Electron process.
 */
export async function evaluateInMain<T>(
  electronApp: ElectronApplication,
  fn: (params: { app: Electron.App; BrowserWindow: typeof Electron.BrowserWindow }) => T
): Promise<T> {
  return electronApp.evaluate(fn as any)
}

/**
 * Get the main window bounds (position and size).
 */
export async function getWindowBounds(electronApp: ElectronApplication) {
  return electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    return win?.getBounds()
  })
}

/**
 * Check if the main window is maximized.
 */
export async function isWindowMaximized(electronApp: ElectronApplication): Promise<boolean> {
  return electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    return win?.isMaximized() ?? false
  })
}
