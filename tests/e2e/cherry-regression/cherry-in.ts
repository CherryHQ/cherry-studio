import type { Page } from '@playwright/test'

import { completeCherryInOauth } from '../../../scripts/cherry-regression-test/cherryin-oauth'
import { sendProtocolUrlToOwnedApp } from '../../../scripts/cherry-regression-test/lifecycle'
import type { RegressionApp } from './app'
import { expect } from './fixture'
import { openSettingsSection } from './models'

export async function ensureCherryInSignedIn(app: RegressionApp, page: Page): Promise<void> {
  await openSettingsSection(page, 'Model Provider')
  await page.getByRole('button', { name: 'CherryIN', exact: true }).click()
  const authorize = page.getByRole('button', { name: 'Authorize with CherryIN', exact: true })
  if (await authorize.isVisible().catch(() => false)) {
    await page.evaluate(() => {
      const original = window.open
      ;(window as typeof window & { __cherryRegressionOauthUrl?: string }).open = ((url?: string | URL) => {
        ;(window as typeof window & { __cherryRegressionOauthUrl?: string }).__cherryRegressionOauthUrl = String(url)
        window.open = original
        return null
      }) as typeof window.open
    })
    await authorize.click()
    const authorizationUrl = await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as typeof window & { __cherryRegressionOauthUrl?: string }).__cherryRegressionOauthUrl
          ),
        { timeout: 30_000 }
      )
      .not.toBeUndefined()
      .then(() =>
        page.evaluate(
          () => (window as typeof window & { __cherryRegressionOauthUrl?: string }).__cherryRegressionOauthUrl!
        )
      )
    const callback = await completeCherryInOauth(authorizationUrl, {
      account: app.config.cherryIn.account,
      password: app.config.cherryIn.password
    })
    await sendProtocolUrlToOwnedApp(app.record, callback)
  }
  await expect(page.getByText('Logged in via OAuth', { exact: true })).toBeVisible({ timeout: 60_000 })
}

export async function addCherryInModel(page: Page, model: string, tab?: string): Promise<void> {
  if (
    await page
      .getByText(model, { exact: true })
      .isVisible()
      .catch(() => false)
  )
    return
  await page.getByRole('button', { name: 'Get model list', exact: true }).click()
  if (tab) {
    const tabLocator = page.getByRole('tab', { name: new RegExp(tab, 'i') })
    if (await tabLocator.isVisible().catch(() => false)) await tabLocator.click()
    else await page.getByText(tab, { exact: true }).click()
  }
  await page.getByPlaceholder('Search models').fill(model)
  await expect(page.getByText(model, { exact: true })).toBeVisible()
  const add = page.getByRole('button', { name: 'Add', exact: true }).first()
  if (await add.isVisible().catch(() => false)) await add.click()
  await page.keyboard.press('Escape')
}
