import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import type { Browser } from '@e2e-dev/web'
import type { Agent, Screen } from 'e2e'
import { expect, unique } from 'e2e'

import type * as mockChatServer from '../../helpers/http/mockChatServer'

const require = createRequire(import.meta.url)
const mock = require('../../helpers/http/mockChatServer.ts') as typeof mockChatServer
export async function startMockChatServer() {
  const server = await mock.startMockChatServer()
  writeFileSync(
    join(dirname(process.env.AGENTIC_CASE_DATA!), 'fixture.json'),
    JSON.stringify({ pid: process.pid, port: Number(new URL(server.baseUrl).port) })
  )
  return server
}
export const phase = process.env.AGENTIC_STAGE ?? 'write'
export const data = JSON.parse(readFileSync(process.env.AGENTIC_CASE_DATA!, 'utf8')) as {
  marker: string
  providerId?: string
  messageId?: string
}
export const persist = () => writeFileSync(process.env.AGENTIC_CASE_DATA!, JSON.stringify(data))

export async function openApp(app: { open(url: string): Promise<void> }, browser: Browser) {
  const record = JSON.parse(readFileSync(process.env.AGENTIC_APP_RECORD!, 'utf8'))
  await app.open(record.targetUrl)
  await expect(browser.locator('#root > *').first()).toBeVisible()
}

export async function chatProvider(agent: Agent, browser: Browser, screen: Screen, baseUrl: string, name: string) {
  await agent.act('Open Settings, then Model Provider, and click Add Provider.', { timeout: 90_000 })
  await expect(browser.locator('input[placeholder="Example: OpenAI"]')).toBeVisible()
  await agent.act(
    'Create an OpenAI-compatible provider named {name}. Enter mock-api-key for API Key, {baseUrl} for OpenAI URL, and {baseUrl} for Anthropic URL. Click Add, then Skip the model setup.',
    {
      params: { name: unique(name), baseUrl: unique(baseUrl) },
      timeout: 120_000
    }
  )
  await expect(screen.getByRole('heading', { name, exact: true })).toBeVisible()
  if ((await screen.getByRole('switch').last().getAttribute('aria-checked')) !== 'true') {
    await agent.act('Turn ON the provider header switch next to API Settings. Do not click the provider list item.', {
      timeout: 90_000
    })
  }
  await expect(screen.getByRole('switch').last()).toHaveAttribute('aria-checked', 'true')
  await agent.act(
    'Click Add model manually. Enter mock-chat as Model ID and save with Add Model. Do not open model settings or delete any model.',
    { timeout: 90_000 }
  )
  await expect(screen.getByText('mock-chat', { exact: true }).last()).toBeVisible()
  const item = browser.locator('[data-testid^="provider-list-item-"]').filter({ hasText: name })
  data.providerId = (await item.getAttribute('data-testid'))!.replace('provider-list-item-', '')
  persist()
  await agent.act(
    'Use Back to leave Settings, then click Chat in the left sidebar (not Work). Open Selected models, search for mock-chat, select mock-chat from provider {name}, and close the selector. Do not use Configure custom models. If the model is missing, stop and report the problem.',
    { params: { name: unique(name) }, timeout: 90_000 }
  )
  await expect(screen.getByRole('button', { name: 'Selected models', exact: true })).toContainText('mock-chat')
}

export async function sendMessage(agent: Agent, browser: Browser, prompt: string) {
  await agent.act('Enter {prompt} in the chat composer and click Send.', {
    params: { prompt: unique(prompt) },
    timeout: 90_000
  })
  await expect(browser.locator('[data-ui~="chat.message"]').filter({ hasText: prompt }).first()).toBeVisible()
}

export async function storedMessage(browser: Browser, id: string) {
  const response = await browser.evaluate(
    (messageId) => window.api.dataApi.request({ id: 'agentic-read', method: 'GET', path: `/messages/${messageId}` }),
    id
  )
  expect(response.status).toBe(200)
  return response.data as { id: string; status: string; data: { parts: unknown[] } }
}
