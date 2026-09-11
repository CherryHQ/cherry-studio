import { copyFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Browser, Page } from '@playwright/test'
import { chromium } from '@playwright/test'

import { prepareWindowsCdpConnection } from '../../../scripts/cherry-regression-test/debugBridge'
import { loadTestConfig, type RegressionTestConfig } from '../../../scripts/cherry-regression-test/config'
import {
  ensureProfile,
  readAppRecord,
  restartApp,
  type AppRecord
} from '../../../scripts/cherry-regression-test/lifecycle'
import { getRunPaths, type RunPaths } from '../../../scripts/cherry-regression-test/paths'
import type { TestProfile } from '../../../scripts/cherry-regression-test/types'

const MAIN_WINDOW_PATH = '/windows/main/index.html'

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

  private async connect(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser
    const record = this.record
    const { cdpPort } = record
    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, {
      isLocal: true,
      noDefaults: true,
      timeout: 30_000
    })
    return this.browser
  }

  async mainWindow(): Promise<Page> {
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
      if (page) {
        await page.locator('#root').waitFor({ state: 'visible', timeout: 60_000 })

        return page
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
    } while (Date.now() < deadline)
    throw new Error('Cherry Studio 主窗口在 60 秒内未就绪')
  }

  async window(pathFragment: string): Promise<Page> {
    const browser = await this.connect()
    const deadline = Date.now() + 30_000
    do {
      const page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().toLowerCase().includes(pathFragment.toLowerCase()))
      if (page) return page
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
    } while (Date.now() < deadline)
    throw new Error(`未找到窗口：${pathFragment}`)
  }

  async cleanupTransientUi(mainWindow: Page): Promise<void> {
    await mainWindow.keyboard.press('Escape').catch(() => undefined)
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

  async useProfile(profile: TestProfile): Promise<Page> {
    await this.disconnect()
    const record = await ensureProfile(this.paths, profile)
    await prepareWindowsCdpConnection(record)
    return this.mainWindow()
  }
}
