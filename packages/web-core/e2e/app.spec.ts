import type { Page } from '@playwright/test'

import type { DataRequest, DataResponse } from '@shared/data/api/types'

import { composerInput, gotoApp, removeAppData, sidebarApps } from './appPage'
import { expect, test as harnessTest } from './fixtures'
import { MOCK_PROVIDER_PORT } from './mockProvider'

declare global {
  interface Window {
    api: { dataApi: { request(request: DataRequest): Promise<DataResponse> } }
  }
}

// The app always opens the one local account, so its data is removed after each test.
const test = harnessTest.extend<{ page: Page }>({
  page: async ({ context }, provide) => {
    await provide(context.pages()[0] ?? (await context.newPage()))
    await removeAppData(context)
  }
})

test('runs the desktop main window with only the Web edition features', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await gotoApp(page)

  await expect(sidebarApps(page)).toHaveCount(2)
  expect(await sidebarApps(page).evaluateAll((buttons) => buttons.map((button) => button.ariaLabel))).toEqual([
    'Work',
    'Chat'
  ])

  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.locator('[data-ui~="part:menu-item"]')).toHaveText([
    'Model Provider',
    'Default Model',
    'General',
    'Appearance',
    'About & Feedback'
  ])
  expect(pageErrors).toEqual([])
})

test('chats through the desktop composer and keeps the conversation across a reload', async ({ page }) => {
  const run = Date.now().toString(36)
  const message = `hello from the web page ${run}`
  await gotoApp(page)
  // Point every assistant at the mock endpoint; the trial's model source is not decided yet.
  await page.evaluate(
    async ({ baseUrl, providerId }) => {
      const request = async (method: DataRequest['method'], path: string, body?: unknown) => {
        const response = await window.api.dataApi.request({ id: crypto.randomUUID(), method, path, body })
        if (response.error) throw new Error(`${method} ${path}: ${response.error.message}`)
        return response.data as { items: { id: string }[] }
      }
      await request('POST', '/providers', {
        providerId,
        name: 'Mock provider',
        defaultChatEndpoint: 'openai-chat-completions',
        endpointConfigs: { 'openai-chat-completions': { baseUrl: `${baseUrl}/v1` } },
        apiKeys: [{ id: crypto.randomUUID(), key: 'sk-web-trial', isEnabled: true }]
      })
      await request('POST', '/models', [
        { providerId, modelId: 'mock-chat', name: 'Mock chat', endpointTypes: ['openai-chat-completions'] }
      ])
      for (const { id } of (await request('GET', '/assistants')).items) {
        await request('PATCH', `/assistants/${id}`, { modelId: `${providerId}::mock-chat` })
      }
    },
    { baseUrl: `http://localhost:${MOCK_PROVIDER_PORT}`, providerId: `mock-${run}` }
  )
  await gotoApp(page)

  await composerInput(page).click()
  await page.keyboard.type(message)
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()
  await page.keyboard.press('Enter')
  await expect(page.getByText(`echo: ${message}`)).toBeVisible()
  // The reply shows while it streams; reloading before the turn is saved would end the turn.
  await expect.poll(() => replyStatus(page)).toBe('success')

  await gotoApp(page)
  await expect(page.getByText(message, { exact: true })).toBeVisible()
  await expect(page.getByText(`echo: ${message}`)).toBeVisible()
})

/** Status of the latest message in the only topic. */
function replyStatus(page: Page): Promise<string | undefined> {
  return page.evaluate(async () => {
    const request = (path: string) => window.api.dataApi.request({ id: crypto.randomUUID(), method: 'GET', path })
    const topics = (await request('/topics')).data as { items: { activeNodeId: string | null }[] }
    const tip = topics.items[0]?.activeNodeId
    return tip ? ((await request(`/messages/${tip}`)).data as { status: string }).status : undefined
  })
}
