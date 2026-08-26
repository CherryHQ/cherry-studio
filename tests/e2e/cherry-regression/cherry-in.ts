import type { Page } from '@playwright/test'

import { completeCherryInOauth } from '../../../scripts/cherry-regression-test/cherryin-oauth'
import { sendProtocolUrlToOwnedApp } from '../../../scripts/cherry-regression-test/lifecycle'
import type { RegressionApp } from './app'
import { expect } from './fixture'
import { openSettingsSection } from './models'

export async function ensureCherryInSignedIn(app: RegressionApp, page: Page): Promise<void> {
  await openSettingsSection(page, 'Model Provider')
  await page.getByTestId('provider-list-item-cherryin').click()
  const authorize = page.getByRole('button', { name: 'Authorize with CherryIN', exact: true })
  const logout = page.getByRole('button', { name: 'Logout', exact: true })
  await expect(authorize.or(logout).first()).toBeVisible({ timeout: 60_000 })
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
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const response = await window.api.dataApi.request({
              id: `regression-cherryin-${Date.now()}`,
              method: 'GET',
              path: '/providers/cherryin/api-keys'
            })
            const data = response.data as { keys?: Array<{ label?: string }> } | undefined
            return data?.keys?.some((key) => key.label === 'OAuth') ?? false
          }),
        { timeout: 60_000 }
      )
      .toBe(true)
    await openSettingsSection(page, 'Model Provider')
    const cherryIn = page.getByTestId('provider-list-item-cherryin')
    await cherryIn.click()
    await expect(cherryIn).toHaveAttribute('data-selected', 'true')
  }
  await expect(logout).toBeVisible({ timeout: 3 * 60_000 })
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
  const drawer = page.locator('[data-slot="page-side-panel"][role="dialog"]:visible').first()
  await expect(drawer).toBeVisible()
  if (tab) {
    const tabLocator = drawer.getByRole('tab', { name: new RegExp(tab, 'i') })
    if (await tabLocator.isVisible().catch(() => false)) await tabLocator.click()
  }
  const search = drawer.getByPlaceholder('Search models')
  await expect(search).toBeEnabled()
  await search.fill(model)
  await expect(drawer.getByText(model, { exact: true })).toBeVisible()
  const add = drawer.getByRole('button', { name: 'Add', exact: true }).first()
  if (await add.isVisible().catch(() => false)) await add.click()
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(drawer).toBeHidden()
}
