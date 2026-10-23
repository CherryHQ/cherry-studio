import type { Page } from '@playwright/test'

import { APP_URL, gotoApp, test } from './appPage'
import { expect } from './fixtures'

const storageWarning = (page: Page) => page.getByText('The browser may delete your data')

test('names a site served without the cross-origin isolation headers', async ({ page }) => {
  await page.route(`${APP_URL}/`, async (route) => {
    const response = await route.fetch()
    const headers = { ...response.headers() }
    delete headers['cross-origin-opener-policy']
    delete headers['cross-origin-embedder-policy']
    await route.fulfill({ response, headers })
  })
  await page.goto(APP_URL)
  await expect(page.getByText('it must be served with the Cross-Origin-Opener-Policy')).toBeVisible()
})

test('names a browser without synchronous OPFS access handles', async ({ page }) => {
  // The check runs in the Worker, the only place these handles exist; its script is served without them.
  await page.route(/\/assets\/coreWorker-[^/]+\.js$/, async (route) => {
    const response = await route.fetch()
    const body = `delete FileSystemFileHandle.prototype.createSyncAccessHandle;\n${await response.text()}`
    await route.fulfill({ response, body })
  })
  await page.goto(APP_URL)
  await expect(page.getByText('This browser cannot run Cherry Studio.')).toBeVisible()
})

test('names a browser that refuses storage to the site', async ({ page }) => {
  await page.addInitScript(() =>
    Object.assign(StorageManager.prototype, {
      getDirectory: () => Promise.reject(new DOMException('The operation is insecure.', 'SecurityError'))
    })
  )
  await page.goto(APP_URL)
  await expect(page.getByText('does not let Cherry Studio store data on this site')).toBeVisible()
})

test.describe('when the browser refuses persistent storage', () => {
  test.use({ persistentStorage: false })

  test('warns once per account that the browser may delete the data', async ({ page }) => {
    await page.addInitScript(() => {
      const asked = Number(sessionStorage.getItem('persist-asked') ?? 0)
      Object.assign(StorageManager.prototype, {
        persisted: async () => false,
        persist: async () => {
          sessionStorage.setItem('persist-asked', String(asked + 1))
          return false
        }
      })
    })
    await gotoApp(page)
    await expect(storageWarning(page)).toBeVisible()

    await gotoApp(page)
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('persist-asked'))).toBe('2')
    // The warning would follow the refusal at once; give it the time a slow page would need.
    await page.waitForTimeout(1500)
    await expect(storageWarning(page)).toBeHidden()
  })
})

test('asks for persistent storage and shows no warning when the browser grants it', async ({ page }) => {
  await page.addInitScript(() =>
    Object.assign(StorageManager.prototype, {
      persisted: async () => false,
      persist: async () => {
        sessionStorage.setItem('persist-asked', 'yes')
        return true
      }
    })
  )
  await gotoApp(page)
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('persist-asked'))).toBe('yes')
  await page.waitForTimeout(1500)
  await expect(storageWarning(page)).toBeHidden()
})
