import type { BrowserContext, Locator, Page } from '@playwright/test'

import type { DataRequest, DataResponse } from '@shared/data/api/types'
import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'

import { test as harnessTest } from './fixtures'
import { MOCK_PROVIDER_PORT } from './mockProvider'

declare global {
  interface Window {
    api: {
      dataApi: { request(request: DataRequest): Promise<DataResponse> }
      preference: { set(key: string, value: unknown): Promise<void> }
    }
  }
}

/** Port of the Web app's preview server (`build:app`), next to the harness on 4318. */
export const APP_PORT = 4320
export const APP_URL = `http://localhost:${APP_PORT}`

/**
 * A test of the Web app. The app always opens the one local account, so its data is removed after
 * each test. Headless Chromium refuses persistent storage, and the app's warning about it would
 * cover the page, so the browser grants it unless a test sets `persistentStorage: false`.
 */
export const test = harnessTest.extend<{ page: Page; persistentStorage: boolean }>({
  persistentStorage: [true, { option: true }],
  page: async ({ context, persistentStorage }, provide) => {
    if (persistentStorage) {
      await context.addInitScript(() => Object.assign(StorageManager.prototype, { persist: async () => true }))
    }
    await provide(context.pages()[0] ?? (await context.newPage()))
    await removeAppData(context)
  }
})

/**
 * Opens the Web app on a sidebar section and waits for its composer, past first-run setup when it
 * shows. The app opens on its first sidebar entry, Work (the agents).
 */
export async function gotoApp(page: Page, section: 'Chat' | 'Work' = 'Chat'): Promise<void> {
  await page.goto(APP_URL)
  const composer = composerInput(page)
  const onboarding = page.getByRole('heading', { name: 'Welcome to Cherry Studio' })
  await composer.or(onboarding).first().waitFor()
  if (await onboarding.isVisible()) {
    // The Web edition cannot skip setting up a provider; tests set up theirs (`useMockProvider`) later.
    await page.evaluate(async (policyVersion) => {
      await window.api.preference.set('app.privacy.policy_version', policyVersion)
      await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
    }, LATEST_PRIVACY_POLICY_VERSION)
  }
  await sidebarApps(page)
    .and(page.getByLabel(section, { exact: true }))
    .click()
  await composer.waitFor()
}

/** The sidebar's app entries. */
export function sidebarApps(page: Page): Locator {
  return page.locator('[data-ui="app.sidebar"] [data-ui="ui.item"] button')
}

/** The chat input: a plain textarea until the rich editor loads, which WebKit defers to the first focus. */
export function composerInput(page: Page): Locator {
  return page.locator('[data-ui~="part:composer-input"]').first()
}

/**
 * Removes the app's local account. WebKit keeps OPFS outside the profile directory, so it would
 * otherwise outlive the test. A stub document on the app's origin avoids starting the app, whose
 * Worker would hold the database open.
 */
export async function removeAppData(context: BrowserContext): Promise<void> {
  for (const page of context.pages()) await page.close()
  const page = await context.newPage()
  await page.route(`${APP_URL}/__storage`, (route) => route.fulfill({ contentType: 'text/html', body: '' }))
  await page.goto(`${APP_URL}/__storage`)
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    for (let attempt = 1; ; attempt++) {
      try {
        await (await root.getDirectoryHandle('cherry-studio')).removeEntry('local', { recursive: true })
        return
      } catch (error) {
        if ((error as DOMException).name === 'NotFoundError') return
        if (attempt === 20) throw error
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  })
}

/** Points every assistant at the mock endpoint; the trial's model source is not decided yet. */
export async function useMockProvider(page: Page, run: string): Promise<void> {
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
}

/** Points the built-in assistant at the mock endpoint in `default` mode, so file changes ask first. */
export async function setUpAssistant(page: Page) {
  const run = Date.now().toString(36)
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
        {
          providerId,
          modelId: 'mock-chat',
          name: 'Mock chat',
          endpointTypes: ['openai-chat-completions'],
          capabilities: ['function-call']
        }
      ])
      for (const { id } of (await request('GET', '/agents')).items) {
        await request('PATCH', `/agents/${id}`, {
          model: `${providerId}::mock-chat`,
          configuration: { permission_mode: 'default' }
        })
      }
    },
    { baseUrl: `http://localhost:${MOCK_PROVIDER_PORT}`, providerId: `mock-${run}` }
  )
}

/** Sends a message from the agent composer. */
export async function send(page: Page, text: string) {
  await composerInput(page).click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}
