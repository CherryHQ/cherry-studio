import { rm } from 'node:fs/promises'

import { _electron as electron } from '@playwright/test'

import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { expect, test as base } from './fixtures/electron.fixture'
import { uiLocator } from './utils'

type SignInTestGlobal = typeof globalThis & {
  __signInFailure?: {
    authorizationUrl: string | null
    restore: () => void
  }
}

const test = base.extend({
  electronApp: async ({}, use, testInfo) => {
    const profileRoot = testInfo.outputPath('profile')
    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profileRoot }
    })
    try {
      await use(app)
    } finally {
      try {
        await app.close()
      } finally {
        await rm(profileRoot, { recursive: true, force: true })
      }
    }
  }
})

test('shows the sign-in failure reason below the provider and step', async ({ electronApp }, testInfo) => {
  const page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(async (privacyPolicyVersion) => {
    await window.api.preference.set('app.privacy.policy_version', privacyPolicyVersion)
    await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
    await window.api.preference.set('app.language', 'en-US')
  }, LATEST_PRIVACY_POLICY_VERSION)
  await page.reload()
  await expect(uiLocator(page, 'app.shell').first()).toBeVisible()

  try {
    await electronApp.evaluate(({ net, shell }) => {
      const originalOpenExternal = shell.openExternal
      const originalFetch = net.fetch
      const recorder = {
        authorizationUrl: null as string | null,
        restore: () => {
          shell.openExternal = originalOpenExternal
          net.fetch = originalFetch
        }
      }
      Object.assign(globalThis, { __signInFailure: recorder })
      shell.openExternal = async (url) => {
        recorder.authorizationUrl = url
      }
      net.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes('/oauth/token')) {
          return Promise.resolve(
            new Response('{"error":"invalid_grant","access_token":"TOKEN_MARKER"}', { status: 400 })
          )
        }
        return originalFetch.call(net, input, init)
      }
    })

    const sidebar = uiLocator(page, 'app.sidebar').filter({ visible: true })
    await sidebar.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(uiLocator(page, 'settings.view')).toBeVisible()
    await uiLocator(page, 'settings.navigation')
      .locator('[data-slot="menu-item"]')
      .filter({ hasText: 'Model Provider' })
      .click()
    await uiLocator(page, 'settings.content').getByText('OpenAI Codex', { exact: true }).first().click()
    await page.getByRole('button', { name: 'Sign in with ChatGPT', exact: true }).click()

    await expect
      .poll(() => electronApp.evaluate(() => (globalThis as SignInTestGlobal).__signInFailure?.authorizationUrl))
      .toBeTruthy()
    const authorizationUrl = await electronApp.evaluate(
      () => (globalThis as SignInTestGlobal).__signInFailure!.authorizationUrl!
    )
    const authorization = new URL(authorizationUrl)
    const state = authorization.searchParams.get('state')
    const redirectUri = authorization.searchParams.get('redirect_uri')
    expect(state).toBeTruthy()
    expect(redirectUri).toBeTruthy()
    const callback = new URL(redirectUri!)
    callback.searchParams.set('state', state!)
    callback.searchParams.set('code', 'PROBE_CODE')
    expect((await fetch(callback)).status).toBe(200)

    const notifications = page.locator('[aria-label="notifications"]')
    await notifications.hover()
    await expect(notifications.getByText('OpenAI Codex sign-in failed', { exact: true })).toBeVisible()
    await expect(
      notifications.getByText('During token exchange: The request failed (HTTP 400).', { exact: true })
    ).toBeVisible()
    await expect(notifications).not.toContainText('TOKEN_MARKER')
    const screenshotPath = testInfo.outputPath('sign-in-failure.png')
    await page.screenshot({ path: screenshotPath })
    await testInfo.attach('sign-in-failure', { path: screenshotPath, contentType: 'image/png' })
  } finally {
    await electronApp.evaluate(() => {
      const testGlobal = globalThis as SignInTestGlobal
      testGlobal.__signInFailure?.restore()
      delete testGlobal.__signInFailure
    })
  }
})
