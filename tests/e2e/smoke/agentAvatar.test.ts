import { rm, writeFile } from 'node:fs/promises'

import {
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
  type TestInfo
} from '@playwright/test'
import sharp from 'sharp'

import { AgentEntitySchema } from '../../../src/shared/data/api/schemas/agents'
import { AgentSessionMessageEntitySchema } from '../../../src/shared/data/api/schemas/agentSessionMessages'
import { AgentSessionEntitySchema } from '../../../src/shared/data/api/schemas/agentSessions'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { type MockChatServer, startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/helpers/navigation'
import { expect, test as base } from './fixtures/electron.fixture'
import { stickyWindow } from './utils/stickySmoke'

type AvatarRuntime = { app?: ElectronApplication; pageErrors: string[]; consoleErrors: string[] }

async function launchProfile(profile: string, runtime: AvatarRuntime) {
  const env = { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profile }
  Reflect.deleteProperty(env, 'ELECTRON_RENDERER_URL')
  const app = await electron.launch({ args: ['.'], env, timeout: 60_000 })
  runtime.app = app
  const watch = (page: Page) => {
    page.on('pageerror', (error) => runtime.pageErrors.push(error.stack ?? error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' || message.text().includes('[error]')) runtime.consoleErrors.push(message.text())
    })
  }
  app.on('window', watch)
  for (const page of app.windows()) watch(page)
  return app
}

async function mainPage(app: ElectronApplication) {
  const page = await stickyWindow(app)
  await page.waitForSelector('#root', { state: 'attached', timeout: 60_000 })
  await page.waitForLoadState('domcontentloaded')
  return page
}

const test = base.extend<{ avatarRuntime: AvatarRuntime; server: MockChatServer }>({
  avatarRuntime: async ({}, provide) => {
    await provide({ pageErrors: [], consoleErrors: [] })
  },
  electronApp: async ({ avatarRuntime }, provide, testInfo) => {
    const profile = testInfo.outputPath('profile')
    try {
      await provide(await launchProfile(profile, avatarRuntime))
    } finally {
      try {
        await avatarRuntime.app?.close()
      } finally {
        await rm(profile, { recursive: true, force: true })
        const path = testInfo.outputPath('renderer-errors.json')
        const { pageErrors, consoleErrors } = avatarRuntime
        await writeFile(path, JSON.stringify({ pageErrors, consoleErrors }, null, 2))
        await testInfo.attach('renderer-errors', { path, contentType: 'application/json' })
        expect(avatarRuntime.pageErrors, 'No renderer pageerror across launch, reload, restart, and reset').toEqual([])
      }
    }
  },
  mainWindow: async ({ electronApp }, provide) => {
    await provide(await mainPage(electronApp))
  },
  server: async ({}, provide) => {
    const server = await startMockChatServer()
    try {
      await provide(server)
    } finally {
      await server.close()
    }
  }
})

test.setTimeout(240_000)

async function initialize(page: Page) {
  await page.evaluate(async (policy) => {
    await window.api.preference.set('app.privacy.policy_version', policy)
    await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
    await window.api.preference.set('app.language', 'en-US')
    await window.api.preference.set('topic.naming.enabled', false)
  }, LATEST_PRIVACY_POLICY_VERSION)
  await page.reload()
  await expect(page.locator('[data-ui~="app.shell"]').first()).toBeVisible({ timeout: 90_000 })
  await selectSidebarApp(page, 'Work')
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

async function expectDecodedImage(img: Locator) {
  await expect(img).toBeVisible()
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
}

async function closeAgentDialog(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Edit Agent', exact: true, includeHidden: true })
  const confirmation = page.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect.poll(async () => (await confirmation.isVisible()) || (await dialog.isHidden())).toBe(true)
  if (await confirmation.isVisible()) {
    await confirmation.getByRole('button', { name: 'Discard changes', exact: true }).click()
  }
  await expect(dialog).toBeHidden()
}

async function readAgent(page: Page, id: string) {
  const response = await page.evaluate(
    (id) => window.api.dataApi.request({ id: 'avatar-agent', method: 'GET', path: `/agents/${id}` }),
    id
  )
  expect(response.status).toBe(200)
  return AgentEntitySchema.parse(response.data)
}

async function catalog(page: Page, name: string) {
  const view = page.locator('[data-ui~="agent.view"]').filter({ visible: true }).first()
  await view.getByRole('button', { name: 'Display mode', exact: true }).click()
  await page.getByText('Manage Agents', { exact: true }).click()
  const card = view
    .locator('[data-ui~="resource-catalog.card.button"]')
    .and(view.getByRole('button', { name, exact: true }))
  await expect(card).toBeVisible()
  return card
}

async function openSession(page: Page, agentName: string, sessionName: string) {
  const view = page.locator('[data-ui~="agent.view"]').filter({ visible: true }).first()
  const sessions = view.getByTestId('resource-list-session')
  const agentHeader = sessions.getByRole('button', { name: agentName, exact: true })
  await agentHeader.click()
  const conversation = sessions.getByText(sessionName, { exact: true }).first()
  if (!(await conversation.isVisible())) {
    await agentHeader.hover()
    await agentHeader.locator('..').getByRole('button', { name: 'Expand', exact: true }).click()
  }
  await conversation.click()
  return view
}

function messageAvatar(page: Page, reply: string) {
  return page.locator('[data-ui~="chat.message"]').filter({ hasText: reply }).locator('.message-header .message-avatar')
}

async function sendTurn(page: Page, server: MockChatServer, sessionId: string, prompt: string, reply: string) {
  const view = page.locator('[data-ui~="agent.view"]').filter({ visible: true }).first()
  const composer = view.locator('[data-ui~="chat.composer"]').filter({ visible: true }).first()
  await composer.locator('[contenteditable="true"]').first().fill(prompt)
  await view.getByRole('button', { name: 'Send', exact: true }).click()
  let matched = false
  const deadline = Date.now() + 30_000
  while (!matched && Date.now() < deadline) {
    const request = await server.nextRequest(Math.max(1, deadline - Date.now()))
    matched =
      request.body.model === server.modelId &&
      request.body.messages.some((message) => {
        const value = message as { role?: string; content?: unknown }
        return value.role === 'user' && JSON.stringify(value.content).includes(prompt)
      })
    request.complete(matched ? reply : 'Background request complete')
  }
  expect(matched).toBe(true)
  await expect(view.locator('[data-ui~="chat.message"]').filter({ hasText: reply })).toBeVisible({ timeout: 30_000 })
  await expect(view.getByRole('button', { name: 'Send', exact: true })).toBeVisible()
  let snapshot: ReturnType<typeof AgentSessionMessageEntitySchema.parse>['messageSnapshot'] | undefined
  await expect
    .poll(
      async () => {
        const response = await page.evaluate(
          (id) =>
            window.api.dataApi.request({
              id: 'avatar-messages',
              method: 'GET',
              path: `/agent-sessions/${id}/messages`
            }),
          sessionId
        )
        expect(response.status).toBe(200)
        const items = (response.data as { items: unknown[] }).items.map((item) =>
          AgentSessionMessageEntitySchema.parse(item)
        )
        const message = items.find(
          (item) => item.role === 'assistant' && item.status === 'success' && JSON.stringify(item.data).includes(reply)
        )
        snapshot = message?.messageSnapshot
        return Boolean(message)
      },
      { timeout: 15_000 }
    )
    .toBe(true)
  return snapshot!
}

test('persists an uploaded agent avatar and freezes past message avatars after reset', async ({
  electronApp,
  mainWindow,
  avatarRuntime,
  server
}, testInfo) => {
  let page = mainWindow
  await initialize(page)
  const providerId = 'agent-avatar-smoke'
  const provider = await page.evaluate(
    ({ providerId, baseUrl }) =>
      window.api.dataApi.request({
        id: 'avatar-provider',
        method: 'POST',
        path: '/providers',
        body: {
          providerId,
          name: 'Avatar smoke mock',
          defaultChatEndpoint: 'openai-chat-completions',
          endpointConfigs: { 'openai-chat-completions': { baseUrl } },
          apiKeys: [{ id: 'mock-key', key: 'mock-key', isEnabled: true }]
        }
      }),
    { providerId, baseUrl: server.baseUrl }
  )
  expect(provider.status).toBe(201)
  const enabled = await page.evaluate(
    (id) =>
      window.api.dataApi.request({
        id: 'avatar-enable',
        method: 'PATCH',
        path: `/providers/${id}`,
        body: { isEnabled: true }
      }),
    providerId
  )
  expect(enabled.status).toBe(200)
  const models = await page.evaluate(
    ({ providerId, modelId }) =>
      window.api.dataApi.request({
        id: 'avatar-model',
        method: 'POST',
        path: '/models',
        body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
      }),
    { providerId, modelId: server.modelId }
  )
  expect(models.status).toBe(201)
  const created = await page.evaluate(
    ({ model }) =>
      window.api.ipcApi.request('ai.agent.create', {
        type: 'pi',
        name: 'Avatar Agent Probe',
        model,
        instructions: 'Answer briefly without using tools.'
      }),
    { model: createUniqueModelId(providerId, server.modelId) }
  )
  expect(created).toMatchObject({ ok: true })
  const agent = AgentEntitySchema.parse((created as { data: unknown }).data)
  const sessionResponse = await page.evaluate(
    (agentId) =>
      window.api.dataApi.request({
        id: 'avatar-session',
        method: 'POST',
        path: '/agent-sessions',
        body: { agentId, name: 'Avatar session', workspace: { type: 'system' } }
      }),
    agent.id
  )
  expect(sessionResponse.status).toBe(201)
  const session = AgentSessionEntitySchema.parse(sessionResponse.data)
  await page.reload()
  await selectSidebarApp(page, 'Work')
  let card = await catalog(page, agent.name)
  await card.click()
  let dialog = page.getByRole('dialog', { name: 'Edit Agent', exact: true })
  await expect(dialog).toBeVisible()
  const picker = dialog.getByRole('button', { name: 'Choose avatar', exact: true }).first()
  await picker.click()
  const fixture = testInfo.outputPath('avatar.png')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#ff2d9b"/><circle cx="64" cy="64" r="52" fill="none" stroke="white" stroke-width="8"/><text x="64" y="87" text-anchor="middle" font-family="sans-serif" font-size="64" fill="white">A</text></svg>`
  await sharp(Buffer.from(svg)).png().toFile(fixture)
  await testInfo.attach('avatar-fixture', { path: fixture, contentType: 'image/png' })
  const input = page.getByLabel('Image Upload', { exact: true })
  await input.setInputFiles(fixture)
  await expectDecodedImage(picker.locator('img'))
  const uploaded = await readAgent(page, agent.id)
  expect(uploaded.avatarFileId).toBeTruthy()
  expect(uploaded.avatarSrc).toMatch(/^file:\/\/\/.+/)
  const emoji = uploaded.configuration?.avatar?.trim() || '🤖'
  await screenshot(page, testInfo, 'agent-avatar-editor-uploaded')
  await closeAgentDialog(page)
  await expect(card.locator('img')).toHaveAttribute('src', uploaded.avatarSrc!)
  await expectDecodedImage(card.locator('img'))
  await screenshot(page, testInfo, 'agent-avatar-catalog')
  let view = await openSession(page, agent.name, 'Avatar session')
  const label = view.locator('[data-ui~="agent.composer.label"]').filter({ visible: true }).first()
  await expectDecodedImage(label.locator('img'))
  await expect(label.locator('img')).toHaveAttribute('src', uploaded.avatarSrc!)
  await screenshot(page, testInfo, 'agent-avatar-label')
  await label.click()
  const option = page.locator(`[data-option-row="${agent.id}"]`)
  await expectDecodedImage(option.locator('img'))
  await expect(option.locator('img')).toHaveAttribute('src', uploaded.avatarSrc!)
  await screenshot(page, testInfo, 'agent-avatar-selector')
  await page.keyboard.press('Escape')
  const oldSnapshot = await sendTurn(page, server, session.id, 'Check uploaded agent avatar', 'agent avatar turn')
  expect(oldSnapshot?.avatarFileId).toBe(uploaded.avatarFileId)
  await expectDecodedImage(messageAvatar(page, 'agent avatar turn').locator('img'))
  await expect(messageAvatar(page, 'agent avatar turn').locator('img')).toHaveAttribute('src', uploaded.avatarSrc!)
  await screenshot(page, testInfo, 'agent-avatar-message-header')
  await electronApp.close()
  const restarted = await launchProfile(testInfo.outputPath('profile'), avatarRuntime)
  page = await mainPage(restarted)
  await initialize(page)
  expect((await readAgent(page, agent.id)).avatarFileId).toBe(uploaded.avatarFileId)
  card = await catalog(page, agent.name)
  await expectDecodedImage(card.locator('img'))
  await expect(card.locator('img')).toHaveAttribute('src', uploaded.avatarSrc!)
  await screenshot(page, testInfo, 'agent-avatar-after-restart')
  await card.click()
  dialog = page.getByRole('dialog', { name: 'Edit Agent', exact: true })
  await dialog.getByRole('button', { name: 'Choose avatar', exact: true }).first().click()
  await page.getByRole('button', { name: 'Reset avatar', exact: true }).click()
  await expect.poll(async () => (await readAgent(page, agent.id)).avatarFileId).toBeUndefined()
  expect((await readAgent(page, agent.id)).configuration?.avatar?.trim() || '🤖').toBe(emoji)
  await closeAgentDialog(page)
  await expect(card.locator('img')).toHaveCount(0)
  await expect(card).toContainText(emoji)
  await screenshot(page, testInfo, 'agent-avatar-after-reset')
  view = await openSession(page, agent.name, 'Avatar session')
  await expectDecodedImage(messageAvatar(page, 'agent avatar turn').locator('img'))
  const newSnapshot = await sendTurn(page, server, session.id, 'Check reset agent avatar', 'agent reset turn')
  expect(newSnapshot).toMatchObject({ id: agent.id, emoji })
  expect(newSnapshot?.avatarFileId).toBeUndefined()
  await expect(messageAvatar(page, 'agent reset turn').locator('img')).toHaveCount(0)
  await expect(messageAvatar(page, 'agent reset turn')).toContainText(emoji)
  await expectDecodedImage(messageAvatar(page, 'agent avatar turn').locator('img'))
  await screenshot(page, testInfo, 'agent-avatar-old-and-new-messages')
})
