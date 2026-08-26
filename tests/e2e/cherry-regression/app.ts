import type { Browser, Page } from '@playwright/test'
import { chromium } from '@playwright/test'

import { loadTestConfig, type RegressionTestConfig } from '../../../scripts/cherry-regression-test/config'
import {
  ensureProfile,
  prepareWindowsCdpConnection,
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

  constructor(runDirectory: string) {
    this.paths = getRunPaths(runDirectory)
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
    await prepareWindowsCdpConnection(record)
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
        if (this.record.profile === 'authenticated') {
          const status = await page.evaluate(() => window.api.preference.get('app.onboarding.provider_setup.status'))
          if (status === 'pending') {
            await page.evaluate(async () => {
              await window.api.preference.setMultiple({
                'app.onboarding.provider_setup.status': 'skipped',
                'app.privacy.data_collection.enabled': false
              })
            })
          }
          await page
            .locator('[data-ui="app.shell"]')
            .first()
            .waitFor({ state: 'visible', timeout: 2 * 60_000 })
        }
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
    await restartApp(this.paths, profile)
    return this.mainWindow()
  }

  async useProfile(profile: TestProfile): Promise<Page> {
    await this.disconnect()
    await ensureProfile(this.paths, profile)
    return this.mainWindow()
  }
}
