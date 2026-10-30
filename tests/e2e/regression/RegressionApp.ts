import { copyFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'

import type { Browser, Page } from '@playwright/test'
import { chromium } from '@playwright/test'

import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { loadTestConfig, type RegressionTestConfig } from '../../../scripts/e2e/regression/config'
import { assertOwnedAppIsolation, prepareWindowsCdpConnection } from '../../../scripts/e2e/regression/debugBridge'
import {
  adoptRelaunchedApp,
  ensureProfile,
  readAppRecord,
  restartApp,
  type AppRecord
} from '../../../scripts/e2e/regression/lifecycle'
import { getRunPaths, type RunPaths } from '../../../scripts/e2e/regression/paths'
import { cancelNativeFileDialogs } from '../../../scripts/e2e/regression/systemAutomation'
import type { TestProfile } from '../../../scripts/e2e/regression/types'
import { dismissTransientDialogs } from './helpers/navigation'

const MAIN_WINDOW_PATH = '/windows/main/index.html'

const rootVisible = (page: Page, timeout: number) =>
  page
    .locator('#root')
    .waitFor({ state: 'visible', timeout })
    .then(
      () => true,
      () => false
    )

export class RegressionApp {
  readonly paths: RunPaths
  private browser?: Browser

  constructor(
    runDirectory: string,
    readonly caseId: string
  ) {
    const paths = getRunPaths(runDirectory)
    this.paths = { ...paths, workspace: join(paths.workspace, `agent-workspace-${caseId}`) }
    mkdirSync(this.paths.workspace, { recursive: true })
    copyFileSync(join(paths.workspace, 'TASK.md'), join(this.paths.workspace, 'TASK.md'))
  }

  get workspaceName(): string {
    return basename(this.paths.workspace)
  }

  fixturesPath(...segments: string[]): string {
    return join(this.paths.fixtures, ...segments)
  }

  resourceName(name: string): string {
    return `${name} ${this.caseId}`
  }

  get config(): RegressionTestConfig {
    return loadTestConfig()
  }

  get record(): AppRecord {
    return readAppRecord(this.paths)
  }

  async disconnect(): Promise<void> {
    if (this.browser?.isConnected()) await this.browser.close()
    this.browser = undefined
  }

  private recoveredOwnership = false

  private async connect(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser
    let record = this.record
    try {
      await assertOwnedAppIsolation(record, join(this.paths.profiles, record.profile, 'home'))
    } catch (error) {
      // The recorded instance crashed or lost its inspector; one stale record would fail every
      // later case. Relaunch once — the re-check below still gates the replacement process.
      if (this.recoveredOwnership) throw error
      this.recoveredOwnership = true
      try {
        await this.disconnect()
        record = await restartApp(this.paths)
        await assertOwnedAppIsolation(record, join(this.paths.profiles, record.profile, 'home'))
      } catch (recoveryError) {
        if (error instanceof Error) error.cause = recoveryError
        throw error
      }
    }
    const { cdpPort } = record
    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, {
      isLocal: true,
      noDefaults: true,
      timeout: 30_000
    })
    return this.browser
  }

  /** Set by cases that deliberately leave the window hidden (tray-only startup or close-to-tray). */
  windowHiddenExpected = false
  private recoveringWindow = false

  async mainWindow(): Promise<Page> {
    const page = await this.findMainWindow()
    if (this.windowHiddenExpected) return page
    if (await rootVisible(page, 5_000)) return page
    // A case that hides the window leaves the renderer mounted but unrendered, so every
    // later case would spend its timeout on a hidden #root. Reveal the window instead.
    if (!this.recoveringWindow) {
      this.recoveringWindow = true
      try {
        if ((await this.revealWindow()) && (await rootVisible(page, 20_000))) return page
        await this.disconnect()
        await prepareWindowsCdpConnection(await restartApp(this.paths))
      } finally {
        this.recoveringWindow = false
      }
      return await this.mainWindow()
    }
    await page.locator('#root').waitFor({ state: 'visible', timeout: 60_000 })
    return page
  }

  private async findMainWindow(): Promise<Page> {
    const deadline = Date.now() + 60_000
    do {
      const browser = await this.connect()
      const page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => {
          try {
            return new URL(candidate.url()).pathname.endsWith(MAIN_WINDOW_PATH)
          } catch {
            return false
          }
        })
      if (page) return page
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
    } while (Date.now() < deadline)
    throw new Error('Cherry Studio main window was not ready within 60 seconds')
  }

  private async revealWindow(): Promise<boolean> {
    if (this.record.platform !== 'macos') return false
    const { inspectStartup } = await import('./helpers/startupInspection')
    return inspectStartup(this, 'show').then(
      () => true,
      () => false
    )
  }

  async window(pathFragment: string, tabId?: string): Promise<Page> {
    const browser = await this.connect()
    const deadline = Date.now() + 30_000
    do {
      const pages = browser
        .contexts()
        .flatMap((context) => context.pages())
        .filter((candidate) => candidate.url().toLowerCase().includes(pathFragment.toLowerCase()))
      for (const page of pages) {
        if (!tabId) return page
        const data = await page
          .evaluate(async () => {
            const result = (await window.api.ipcApi.request('window.get_init_data')) as IpcResult<{
              tabId?: string
            } | null>
            return result.ok ? result.data : null
          })
          .catch(() => null)
        if (data?.tabId === tabId) return page
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
    } while (Date.now() < deadline)
    throw new Error(`Window not found: ${pathFragment}${tabId ? ` (tab ${tabId})` : ''}`)
  }

  async cleanupTransientUi(mainWindow: Page): Promise<void> {
    await cancelNativeFileDialogs(this.record.platform, this.paths)
    await dismissTransientDialogs(mainWindow)
    const browser = await this.connect()
    const transientPages = browser
      .contexts()
      .flatMap((context) => context.pages())
      .filter((page) => /\/windows\/(quickassistant|selection)\//i.test(page.url()))
    await Promise.all(transientPages.map((page) => page.keyboard.press('Escape').catch(() => undefined)))
  }

  async restart(profile?: TestProfile): Promise<Page> {
    await this.disconnect()
    const record = await restartApp(this.paths, profile)
    await prepareWindowsCdpConnection(record)
    return this.mainWindow()
  }

  async adoptRelaunch(): Promise<Page> {
    await this.disconnect()
    const record = await adoptRelaunchedApp(this.paths)
    await prepareWindowsCdpConnection(record)
    return this.mainWindow()
  }

  async useProfile(profile: TestProfile): Promise<Page> {
    await this.disconnect()
    const record = await ensureProfile(this.paths, profile)
    await prepareWindowsCdpConnection(record)
    return this.mainWindow()
  }
}
