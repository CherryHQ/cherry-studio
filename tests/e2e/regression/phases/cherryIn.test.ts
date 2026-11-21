import { chromium } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'

import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { captureCherryInAuthorizationUrl, CHERRYIN_CALLBACK } from '../../../../scripts/e2e/regression/debugBridge'
import { expect, test } from '../fixture'
import { selectChatModel, sendChatMarker } from '../helpers/chat'
import { closeSettings, openSettingsSection } from '../helpers/settings'
import { prepareScenario } from '../setup'

const CHERRYIN_ORIGIN = 'https://open.cherryin.ai'
const MODEL = 'deepseek/deepseek-flash'

test(...caseDefinition('M-01'), async ({ app, mainWindow: page }, testInfo) => {
  const account = process.env.CHERRY_TEST_CHERRYIN_ACCOUNT
  const password = process.env.CHERRY_TEST_CHERRYIN_PASSWORD
  if (!account || !password) {
    throw new Error('CherryIN requires CHERRY_TEST_CHERRYIN_ACCOUNT and CHERRY_TEST_CHERRYIN_PASSWORD')
  }
  testInfo.annotations.push({ type: 'data-source', description: 'Live CherryIN OAuth, model catalog and chat' })

  await openSettingsSection(page, 'Model Provider')
  const provider = page.getByTestId('provider-list-item-cherryin')
  await provider.click()
  const detail = page.getByTestId('provider-detail-shell')
  const authorize = detail.getByRole('button', { name: 'Authorize with CherryIN', exact: true })
  const logout = detail.getByRole('button', { name: 'Logout', exact: true })
  const browser = await chromium.launch()
  try {
    await test.step('Sign in and authorize in the CherryIN browser', async () => {
      const authUrl = await captureCherryInAuthorizationUrl(app.record, () => authorize.click())
      const login = await browser.newPage({ locale: 'en-US' })
      await login.goto(authUrl, { waitUntil: 'commit', timeout: 60_000 })
      await login.waitForURL(
        (url) => url.origin === CHERRYIN_ORIGIN && ['/register', '/oauth/login'].includes(url.pathname),
        { waitUntil: 'commit', timeout: 60_000 }
      )
      if (new URL(login.url()).pathname === '/register') {
        await login.getByText('Sign in', { exact: true }).last().click()
      }
      await login.waitForURL((url) => url.origin === CHERRYIN_ORIGIN && url.pathname === '/oauth/login', {
        waitUntil: 'commit'
      })
      await login.getByPlaceholder('Please enter your username or email address').fill(account)
      await login.getByPlaceholder('Please enter your password').fill(password)
      await login.getByRole('button', { name: 'Sign in', exact: true }).last().click()

      const isCallback = (url: URL) => `${url.origin}${url.pathname}` === CHERRYIN_CALLBACK
      const consent = login.getByRole('button', { name: 'Authorize', exact: true })
      await expect
        .poll(
          async () => {
            const url = new URL(login.url())
            if (isCallback(url)) return true
            if (url.origin === CHERRYIN_ORIGIN && url.pathname === '/oauth/consent') return consent.isVisible()
            if (await login.getByText('invalid credentials', { exact: true }).isVisible()) {
              throw new Error('CherryIN OAuth login rejected the configured account or password')
            }
            if (await login.getByRole('heading', { name: 'Two-Factor Authentication' }).isVisible()) {
              throw new Error('CherryIN OAuth login requires two-factor authentication')
            }
            return false
          },
          { message: 'CherryIN should open the consent page or return to Cherry Studio' }
        )
        .toBe(true)
      if (!isCallback(new URL(login.url()))) {
        await consent.click()
        await login.waitForURL(isCallback)
      }
      await expect(login.getByRole('heading', { name: 'Signed in successfully', exact: true })).toBeVisible()
    })
  } catch (error) {
    const cancel = detail.getByRole('button', { name: 'Cancel', exact: true })
    if (await cancel.isVisible()) await cancel.click()
    throw error
  } finally {
    await browser.close()
  }

  await expect(logout).toBeVisible({ timeout: 60_000 })
  try {
    await expect(detail.getByText(/^\$-?\d+\.\d{2}$/)).toBeVisible({ timeout: 60_000 })
    await test.step('Sync the CherryIN model and send a chat message', async () => {
      await detail.getByRole('button', { name: 'Sync models', exact: true }).click()
      const drawer = page.locator('[data-slot="page-side-panel"][role="dialog"]:visible')
      await drawer.getByPlaceholder('Search models').fill(MODEL)
      const modelRow = drawer.locator('[data-added]').filter({ has: page.getByText(MODEL, { exact: true }) })
      await expect(modelRow).toBeVisible({ timeout: 60_000 })
      const add = modelRow.getByRole('button', { name: 'Add', exact: true })
      if (await add.isVisible()) await add.click()
      await expect(modelRow).toHaveAttribute('data-added', 'true')
      await drawer.getByRole('button', { name: 'Close', exact: true }).click()
      await closeSettings(page)

      const name = app.resourceName('CherryIN conversation')
      const created = await page.evaluate(
        (name) =>
          window.api.dataApi.request({ id: 'm01-assistant', method: 'POST', path: '/assistants', body: { name } }),
        name
      )
      expect(created.status).toBe(201)
      const assistantId = AssistantSchema.parse(created.data).id
      try {
        const topic = await page.evaluate(
          (assistantId) =>
            window.api.dataApi.request({
              id: 'm01-topic',
              method: 'POST',
              path: '/topics',
              body: { name: 'CherryIN setup', assistantId }
            }),
          assistantId
        )
        expect(topic.status).toBe(201)
        await page.reload()
        await prepareScenario(page)
        const row = page.locator('[data-ui~="chat.group-header"]').filter({ hasText: name }).first()
        await row.hover()
        await row.getByRole('button', { name: 'New Chat', exact: true }).press('Enter')
        await selectChatModel(page, MODEL, 'cherryin')
        await sendChatMarker(
          page,
          'Reply with exactly CHERRYIN_CHAT_PASS and nothing else.',
          'CHERRYIN_CHAT_PASS',
          false
        )
      } finally {
        const removed = (await page.evaluate(
          (assistantId) =>
            window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true }),
          assistantId
        )) as { ok: boolean; data?: { deleted: boolean } }
        expect(removed.ok && removed.data?.deleted).toBe(true)
      }
    })
  } finally {
    await openSettingsSection(page, 'Model Provider')
    await provider.click()
    await logout.click()
    await page.getByRole('dialog', { name: 'Logout' }).getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(authorize).toBeEnabled()
  }
})
