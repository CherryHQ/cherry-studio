import { expect, type Page } from '@playwright/test'

import { inspectOwnedAppEnvironment } from '../regression/debugBridge'
import type { AppRecord } from '../regression/lifecycle'
import { QaError, type Result } from './report'

export async function ensureChinese(page: Page, apply = false): Promise<void> {
  try {
    if (apply) {
      await page.evaluate(async () => {
        await window.api.preference.set('app.language', 'zh-CN')
      })
      await page.reload({ timeout: 60_000, waitUntil: 'domcontentloaded' })
    }
    const language = await page.evaluate(async () => window.api.preference.get('app.language'))
    if (language !== 'zh-CN') throw new Error(`Expected app.language zh-CN, observed ${language}`)
    const marker = page
      .getByRole('combobox', { name: '语言', exact: true })
      .or(page.getByRole('button', { name: '启动台', exact: true }))
      .filter({ visible: true })
    await expect(marker.first()).toBeVisible({ timeout: 15_000 })
  } catch (error) {
    if (page.isClosed() || page.context().browser()?.isConnected() === false)
      throw new QaError('environment', 3, 'APP_UNAVAILABLE', String(error))
    throw new QaError(
      'environment',
      2,
      'LOCALE_MISMATCH',
      `Chinese UI verification failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export function verifyTimezone(required: string | undefined, main: string | null, renderer: string | null): void {
  if (!required) return
  const canonical = (value: string | null) =>
    value ? new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone : null
  if (canonical(main) !== canonical(required) || canonical(renderer) !== canonical(required)) {
    throw new QaError(
      'environment',
      2,
      'TIMEZONE_MISMATCH',
      `Required timezone ${required}; main=${main}, renderer=${renderer}`
    )
  }
}

export async function collectEnvironment(page: Page, record: AppRecord, result: Result): Promise<void> {
  try {
    const main = await inspectOwnedAppEnvironment(record)
    result.environment.appVersion = main.version
    result.environment.mainLocale = main.locale
    result.environment.timezone.main = main.timezone
  } catch (error) {
    result.environment.unavailable.push(`Main-process version/locale/timezone: ${String(error)}`)
  }
  const renderer = await page.evaluate(async () => ({
    language: await window.api.preference.get('app.language'),
    locale: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  }))
  result.environment.appLocale = renderer.language
  result.environment.browserLocale = renderer.locale
  result.environment.timezone.renderer = renderer.timezone
}
