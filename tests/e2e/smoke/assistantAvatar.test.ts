import { rm, writeFile } from 'node:fs/promises'

import {
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
  type TestInfo
} from '@playwright/test'
import sharp from 'sharp'

import type { Assistant } from '../../../src/shared/data/types/assistant'
import type { Message } from '../../../src/shared/data/types/message'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { type MockChatServer, startMockChatServer } from '../../helpers/http/mockChatServer'
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

async function openChat(page: Page) {
  await page.evaluate(async (policy) => {
    const p = window.api.preference
    await p.set('app.privacy.policy_version', policy)
    await p.set('app.onboarding.provider_setup.status', 'skipped')
    await p.set('app.language', 'en-US')
  }, LATEST_PRIVACY_POLICY_VERSION)
  await page.reload()
  await expect(page.locator('[data-ui~="app.shell"]').first()).toBeVisible({ timeout: 90_000 })
  await page.waitForTimeout(3500)
  const chat = page
    .locator('[data-ui~="app.sidebar"]')
    .filter({ visible: true })
    .getByRole('button', { name: 'Chat', exact: true })
    .first()
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await chat.click({ timeout: 5000 })
      await expect(page.locator('[data-ui~="chat.view"]').filter({ visible: true }).first()).toBeVisible()
      return
    } catch (error) {
      if (attempt === 4) throw error
    }
  }
}

function assistantRow(page: Page, name: string) {
  return page
    .locator('[data-ui~="chat.view"]')
    .filter({ visible: true })
    .locator('[data-ui~="chat.group-header"]')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first()
}

const leadingSlot = (page: Page, name: string) =>
  assistantRow(page, name).locator('[data-ui~="chat.resource-list-leading-slot"]')

async function expectDecodedImage(img: Locator) {
  await expect(img).toBeVisible()
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
}

async function expectEmoji(slot: Locator, emoji: string) {
  await expect(slot.locator('img')).toHaveCount(0)
  await expect(slot.locator('[data-slot="emoji-icon-foreground"]')).toBeVisible()
  await expect(slot.locator('[data-slot="emoji-icon-foreground"]')).toHaveText(emoji)
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

async function createAssistant(page: Page, name: string, emoji: string) {
  const response = await page.evaluate(
    (body) => window.api.dataApi.request({ id: 'avatar-create', method: 'POST', path: '/assistants', body }),
    { name, emoji }
  )
  expect(response.status).toBe(201)
  return response.data as Assistant
}

async function readAssistant(page: Page, name: string) {
  const response = await page.evaluate(() =>
    window.api.dataApi.request({ id: 'avatar-list', method: 'GET', path: '/assistants' })
  )
  expect(response.status).toBe(200)
  const item = (response.data as { items: Assistant[] }).items.find((assistant) => assistant.name === name)
  expect(item).toBeDefined()
  return item!
}

async function bindMockModel(page: Page, server: MockChatServer, assistantId: string) {
  await page.evaluate(() => window.api.preference.set('topic.naming.enabled', false))
  const providerId = 'assistant-avatar-smoke'
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
  const bound = await page.evaluate(
    ({ id, modelId }) =>
      window.api.dataApi.request({ id: 'avatar-bind', method: 'PATCH', path: `/assistants/${id}`, body: { modelId } }),
    { id: assistantId, modelId: createUniqueModelId(providerId, server.modelId) }
  )
  expect(bound.status).toBe(200)
}

async function openEditor(page: Page, name: string) {
  await page.getByText(name, { exact: true }).first().click({ button: 'right' })
  await page
    .getByRole('menuitem', { name: /edit assistant/i })
    .first()
    .click()
  const dialog = page.getByRole('dialog', { name: 'Edit Assistant', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

async function newChat(page: Page, name: string, modelId: string) {
  const row = assistantRow(page, name)
  await row.hover()
  await row.getByRole('button', { name: 'New Chat', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(modelId)
}

function messageAvatar(page: Page, reply: string) {
  return page.locator('[data-ui~="chat.message"]').filter({ hasText: reply }).locator('.message-header .message-avatar')
}

async function sendTurn(page: Page, server: MockChatServer, prompt: string, reply: string) {
  const composer = page.locator('[data-ui~="chat.composer"]').filter({ visible: true }).first()
  await composer.locator('[contenteditable="true"]').first().fill(prompt)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const request = await server.nextRequest(30_000)
  expect(request.body.model).toBe(server.modelId)
  expect(JSON.stringify(request.body.messages.at(-1))).toContain(prompt)
  request.complete(reply)
  const message = page.locator('[data-ui~="chat.message"]').filter({ hasText: reply })
  await expect(message).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-ui~="chat.composer.action.pause"]')).toBeHidden()
  return message
}

async function readMessage(page: Page, message: Locator) {
  const id = await message.getAttribute('data-message-id')
  expect(id).toBeTruthy()
  const response = await page.evaluate(
    (id) => window.api.dataApi.request({ id: 'avatar-message', method: 'GET', path: `/messages/${id}` }),
    id
  )
  expect(response.status).toBe(200)
  return response.data as Message
}

test('persists an uploaded assistant avatar and freezes past message avatars after reset', async ({
  electronApp,
  mainWindow,
  avatarRuntime,
  server
}, testInfo) => {
  let page = mainWindow
  await openChat(page)
  const assistant = await createAssistant(page, 'Avatar Probe', '🦊')
  await openChat(page)
  await expectEmoji(leadingSlot(page, assistant.name), '🦊')
  const dialog = await openEditor(page, assistant.name)
  const picker = dialog.getByRole('button', { name: 'Choose avatar', exact: true }).first()
  await expect(picker).toBeVisible()
  await screenshot(page, testInfo, 'avatar-editor')
  await picker.click()
  await expect(page.getByRole('button', { name: 'Image Upload', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Emoji Picker', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reset avatar', exact: true })).toBeVisible()
  const fixture = testInfo.outputPath('avatar.png')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <rect width="128" height="128" fill="#ff2d9b" />
    <circle cx="64" cy="64" r="52" fill="none" stroke="white" stroke-width="8" />
    <text x="64" y="87" text-anchor="middle" font-family="sans-serif" font-size="64" font-weight="bold" fill="white">A</text>
  </svg>`
  await sharp(Buffer.from(svg)).png().toFile(fixture)
  await testInfo.attach('avatar-fixture', { path: fixture, contentType: 'image/png' })
  const input = page.locator('input[type="file"]').first()
  await expect
    .poll(async () => (await input.getAttribute('accept'))?.split(',').map((type) => type.trim()))
    .toEqual(expect.arrayContaining(['image/png', 'image/jpeg', 'image/gif', 'image/webp']))
  await expect(input).toHaveAttribute('aria-label', 'Image Upload')
  await input.setInputFiles(fixture)
  await expectDecodedImage(picker.locator('img'))
  await expect(page.getByRole('button', { name: 'Reset avatar', exact: true })).toBeHidden()
  const uploaded = await readAssistant(page, assistant.name)
  expect(uploaded.avatarFileId).toMatch(/^[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12}$/i)
  expect(uploaded.avatarSrc).toMatch(/^file:\/\/\/.+/)
  expect(uploaded.emoji).toBe('🦊')
  await screenshot(page, testInfo, 'avatar-editor-uploaded')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(leadingSlot(page, assistant.name).locator('img')).toHaveAttribute('src', uploaded.avatarSrc!)
  await expectDecodedImage(leadingSlot(page, assistant.name).locator('img'))
  await screenshot(page, testInfo, 'avatar-uploaded-list')

  await bindMockModel(page, server, assistant.id)
  await openChat(page)
  await newChat(page, assistant.name, server.modelId)
  const oldMessage = await sendTurn(page, server, 'Check uploaded avatar', 'avatar turn')
  const oldId = await oldMessage.getAttribute('data-message-id')
  expect((await readMessage(page, oldMessage)).messageSnapshot?.avatarFileId).toBe(uploaded.avatarFileId)
  await expect(messageAvatar(page, 'avatar turn').locator('img')).toHaveAttribute('src', uploaded.avatarSrc!)
  await expectDecodedImage(messageAvatar(page, 'avatar turn').locator('img'))
  await screenshot(page, testInfo, 'avatar-message-header')

  await electronApp.close()
  const restarted = await launchProfile(testInfo.outputPath('profile'), avatarRuntime)
  page = await mainPage(restarted)
  await openChat(page)
  expect((await readAssistant(page, assistant.name)).avatarFileId).toBe(uploaded.avatarFileId)
  await expect(leadingSlot(page, assistant.name).locator('img')).toHaveAttribute('src', uploaded.avatarSrc!)
  await expectDecodedImage(leadingSlot(page, assistant.name).locator('img'))
  const persistedMessage = page.locator('[data-ui~="chat.message"]').filter({ hasText: 'avatar turn' })
  await expect(persistedMessage).toHaveAttribute('data-message-id', oldId!)
  await expect(messageAvatar(page, 'avatar turn').locator('img')).toHaveAttribute('src', uploaded.avatarSrc!)
  await expectDecodedImage(messageAvatar(page, 'avatar turn').locator('img'))
  await screenshot(page, testInfo, 'avatar-after-restart')

  const resetDialog = await openEditor(page, assistant.name)
  await resetDialog.getByRole('button', { name: 'Choose avatar', exact: true }).first().click()
  await page.getByRole('button', { name: 'Reset avatar', exact: true }).click()
  await expect.poll(async () => (await readAssistant(page, assistant.name)).avatarFileId).toBeUndefined()
  await expect(page.getByRole('button', { name: 'Reset avatar', exact: true })).toBeHidden()
  expect((await readAssistant(page, assistant.name)).emoji).toBe('🦊')
  await page.keyboard.press('Escape')
  await expect(resetDialog).toBeHidden()
  await expectEmoji(leadingSlot(page, assistant.name), '🦊')
  await expectDecodedImage(messageAvatar(page, 'avatar turn').locator('img'))
  expect((await readMessage(page, persistedMessage)).messageSnapshot?.avatarFileId).toBe(uploaded.avatarFileId)
  await screenshot(page, testInfo, 'avatar-after-reset')
  const newMessage = await sendTurn(page, server, 'Check reset avatar', 'reset turn')
  await expectEmoji(messageAvatar(page, 'reset turn'), '🦊')
  const snapshot = (await readMessage(page, newMessage)).messageSnapshot
  expect(snapshot).toMatchObject({ id: assistant.id, emoji: '🦊' })
  expect(snapshot?.avatarFileId).toBeUndefined()
  await expectDecodedImage(messageAvatar(page, 'avatar turn').locator('img'))
  await screenshot(page, testInfo, 'avatar-reset-new-message')
})

test('keeps an emoji-only assistant avatar in the list and message header', async ({
  mainWindow: page,
  server
}, testInfo) => {
  await openChat(page)
  const assistant = await createAssistant(page, 'Emoji Avatar Probe', '🐼')
  await bindMockModel(page, server, assistant.id)
  await openChat(page)
  await expectEmoji(leadingSlot(page, assistant.name), '🐼')
  expect((await readAssistant(page, assistant.name)).avatarFileId).toBeUndefined()
  await newChat(page, assistant.name, server.modelId)
  const message = await sendTurn(page, server, 'Check default emoji avatar', 'emoji default turn')
  await expectEmoji(messageAvatar(page, 'emoji default turn'), '🐼')
  const snapshot = (await readMessage(page, message)).messageSnapshot
  expect(snapshot).toMatchObject({ id: assistant.id, emoji: '🐼' })
  expect(snapshot?.avatarFileId).toBeUndefined()
  await screenshot(page, testInfo, 'avatar-emoji-default')
})
