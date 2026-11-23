import { mkdir, rm } from 'node:fs/promises'

import { type ElectronApplication, type Page } from '@playwright/test'

import type { CreateMessageDto } from '../../../src/shared/data/api/schemas/messages'
import type { Message } from '../../../src/shared/data/types/message'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { closeElectronApp, expect, launchSmokeElectron, test as base } from './fixtures/electron.fixture'

const ASSISTANT = 'Restore E2E assistant'
const TOPIC = 'Restore E2E topic'
const MESSAGES = ['Restore E2E question one', 'Restore E2E answer one', 'Restore E2E question two']

const test = base.extend({
  electronApp: async ({}, provideApp, testInfo) => {
    const profile = testInfo.outputPath('profile')
    await mkdir(profile, { recursive: true })
    let app: ElectronApplication | undefined
    try {
      app = await launchSmokeElectron({
        args: ['.'],
        env: Object.fromEntries(
          Object.entries({ ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profile }).filter(
            (pair): pair is [string, string] => pair[1] !== undefined && pair[0] !== 'ELECTRON_RENDERER_URL'
          )
        ),
        timeout: 60_000
      })
      await provideApp(app)
    } finally {
      try {
        if (app) await closeElectronApp(app)
      } finally {
        await rm(profile, { recursive: true, force: true })
      }
    }
  }
})

async function mainWindow(app: ElectronApplication) {
  let page: Page | undefined
  await expect
    .poll(
      () => {
        page = app.windows().find((window) => /\/windows\/main\/index\.html(?:[?#]|$)/.test(window.url()))
        return !!page
      },
      { timeout: 60_000 }
    )
    .toBe(true)
  await page!.waitForSelector('#root', { state: 'attached', timeout: 60_000 })
  await page!.waitForLoadState('domcontentloaded')
  return page!
}

async function seed(page: Page) {
  await page.evaluate(
    async ({ assistantName, topicName, messages }) => {
      const request = async (id: string, method: 'POST' | 'PUT', path: string, body: unknown) => {
        const response = await window.api.dataApi.request({ id, method, path, body } as never)
        const expectedStatus = method === 'POST' ? 201 : 200
        if (response.status !== expectedStatus) throw new Error(`${id}: ${JSON.stringify(response)}`)
        return response.data
      }
      const assistant = (await request('assistant', 'POST', '/assistants', { name: assistantName })) as { id: string }
      const topic = (await request('topic', 'POST', '/topics', { name: topicName, assistantId: assistant.id })) as {
        id: string
      }
      let parentId: string | null = null
      for (const [index, text] of messages.entries()) {
        const body: CreateMessageDto = {
          parentId,
          role: index === 1 ? 'assistant' : 'user',
          status: 'success',
          setAsActive: false,
          data: { parts: [{ type: 'text', text, state: 'done' }] }
        }
        const payload = (await request(`message-${index}`, 'POST', `/topics/${topic.id}/messages`, body)) as {
          message?: Message
          id?: string
        }
        parentId = (payload.message ?? payload).id!
      }
      await request('active', 'PUT', `/topics/${topic.id}/active-node`, { nodeId: parentId })
    },
    { assistantName: ASSISTANT, topicName: TOPIC, messages: MESSAGES }
  )
}

test('restores an archived conversation and its messages without reloading', async ({ electronApp }) => {
  test.setTimeout(240_000)
  const page = await mainWindow(electronApp)
  await page.evaluate(async (policyVersion) => {
    await window.api.preference.set('app.privacy.policy_version', policyVersion)
    await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
    await window.api.preference.set('app.language', 'en-US')
  }, LATEST_PRIVACY_POLICY_VERSION)
  await page.reload()
  await expect(page.locator('[data-ui~="app.content"]').first()).toBeVisible({ timeout: 60_000 })
  await seed(page)

  const assistant = page.getByRole('button', { name: ASSISTANT, exact: true }).first()
  const row = page.getByTestId('topic-list-row').filter({ hasText: TOPIC }).first()
  const chat = page.locator('[data-ui~="chat.view"]:visible')
  await page.getByRole('button', { name: 'Chat', exact: true }).first().click()
  await assistant.click()
  await page.keyboard.press('Escape')
  await row.click()
  await page.waitForTimeout(2000)
  await expect(row).toHaveAttribute('data-selected', 'true')
  for (const message of MESSAGES) await expect(chat.getByText(message, { exact: true })).toBeVisible()

  await row.hover()
  await row.getByRole('button', { name: 'Archive', exact: true }).click()
  for (const message of MESSAGES) await expect(chat.getByText(message, { exact: true })).toBeHidden()

  await page.getByRole('button', { name: 'User', exact: true }).first().click()
  await page
    .getByRole('dialog', { name: 'Account menu' })
    .getByRole('button', { name: 'Settings', exact: true })
    .click()
  await page
    .locator('[data-ui~="settings.navigation"] [data-slot="menu-item"]')
    .filter({ hasText: 'Archive' })
    .first()
    .click()
  const archivedRow = page.locator('[data-slot="item"]').filter({ hasText: TOPIC })
  await expect(archivedRow).toBeVisible()
  await archivedRow.getByRole('button', { name: 'Restore', exact: true }).click()
  await expect(archivedRow).toHaveCount(0)

  await page.getByRole('button', { name: 'Back', exact: true }).first().click()
  const chatButton = page.getByRole('button', { name: 'Chat', exact: true })
  await chatButton.first().click()
  await assistant.click()
  await page.keyboard.press('Escape')
  await row.click()
  await page.waitForTimeout(2000)
  await expect(row).toHaveAttribute('data-selected', 'true')
  for (const message of MESSAGES) await expect(chat.getByText(message, { exact: true })).toBeVisible()
})
