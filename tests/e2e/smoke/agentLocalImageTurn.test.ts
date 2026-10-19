import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import sharp from 'sharp'

import { AgentEntitySchema } from '../../../src/shared/data/api/schemas/agents'
import { AgentSessionMessageEntitySchema } from '../../../src/shared/data/api/schemas/agentSessionMessages'
import { AgentSessionEntitySchema } from '../../../src/shared/data/api/schemas/agentSessions'
import { AgentWorkspaceEntitySchema } from '../../../src/shared/data/api/schemas/agentWorkspaces'
import { createUniqueModelId, MODEL_CAPABILITY } from '../../../src/shared/data/types/model'
import { type MockChatServer, startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test as base } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

const test = base.extend({
  electronApp: async ({}, use, testInfo) => {
    const profile = testInfo.outputPath('profile')
    await mkdir(profile, { recursive: true })
    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profile },
      timeout: 60_000
    })
    try {
      await use(app)
    } finally {
      await app.close()
    }
  },
  mainWindow: async ({ electronApp }, use) => {
    let main: Page | undefined
    await expect
      .poll(
        async () => {
          for (const window of electronApp.windows()) {
            if (!window.isClosed() && (await window.title()) === 'Cherry Studio') {
              main = window
              return true
            }
          }
          return false
        },
        { timeout: 60_000 }
      )
      .toBe(true)
    await main!.waitForLoadState('domcontentloaded')
    await expect(main!.locator('#root')).toBeAttached()
    await use(main!)
  }
})

async function openSession(page: Page, agentName: string, sessionName: string) {
  await selectSidebarApp(page, 'Work')
  const view = uiLocator(page, 'agent.view').filter({ visible: true }).first()
  const header = view.getByRole('button', { name: agentName, exact: true }).first()
  await header.click()
  const row = view.getByText(sessionName, { exact: true }).first()
  if (!(await row.isVisible())) await header.click()
  await row.click()
  await expect(uiLocator(view, 'chat.composer').filter({ visible: true }).first()).toBeVisible()
  return view
}

async function createSession(page: Page, server: MockChatServer, workspacePath: string) {
  // Onboarding has no UI-contract node; its documented language control is a dedicated attribute.
  const language = page.locator('[data-onboarding-language-select]')
  await expect(uiLocator(page, 'chat.composer').or(language).filter({ visible: true }).first()).toBeVisible()
  if (await language.isVisible()) {
    await language.getByRole('combobox').click()
    await page.getByRole('option', { name: 'English', exact: false }).click()
    await page.getByRole('button', { name: 'Set up later', exact: true }).click()
  }
  await page.evaluate(async () => {
    await window.api.preference.set('app.language', 'en-US')
    await window.api.preference.set('topic.naming.enabled', false)
  })
  const providerId = `local-image-${Date.now()}`
  const agentName = `Local image agent ${providerId}`
  const sessionName = `Local image session ${providerId}`
  const provider = await page.evaluate(
    ({ providerId, baseUrl }) =>
      window.api.dataApi.request({
        id: 'local-image-provider',
        method: 'POST',
        path: '/providers',
        body: {
          providerId,
          presetProviderId: 'lmstudio',
          name: 'LM Studio image smoke',
          defaultChatEndpoint: 'openai-chat-completions',
          endpointConfigs: { 'openai-chat-completions': { baseUrl, adapterFamily: 'openai-compatible' } },
          apiKeys: [{ id: 'mock-key', key: 'mock-key', isEnabled: true }]
        }
      }),
    { providerId, baseUrl: server.baseUrl }
  )
  expect(provider.status).toBe(201)
  const enabled = await page.evaluate(
    (providerId) =>
      window.api.dataApi.request({
        id: 'local-image-enable',
        method: 'PATCH',
        path: `/providers/${providerId}`,
        body: { isEnabled: true }
      }),
    providerId
  )
  expect(enabled.status).toBe(200)
  const model = await page.evaluate(
    ({ providerId, modelId, capability }) =>
      window.api.dataApi.request({
        id: 'local-image-model',
        method: 'POST',
        path: '/models',
        body: [{ providerId, modelId, capabilities: [capability], endpointTypes: ['openai-chat-completions'] }]
      }),
    { providerId, modelId: server.modelId, capability: MODEL_CAPABILITY.IMAGE_RECOGNITION }
  )
  expect(model.status).toBe(201)
  const created = await page.evaluate(
    ({ name, model }) =>
      window.api.ipcApi.request('ai.agent.create', {
        type: 'pi',
        name,
        model,
        instructions: 'Answer briefly without using tools.'
      }),
    { name: agentName, model: createUniqueModelId(providerId, server.modelId) }
  )
  expect(created).toMatchObject({ ok: true })
  const agent = AgentEntitySchema.parse((created as { data: unknown }).data)
  const registered = await page.evaluate(
    (workspacePath) =>
      window.api.ipcApi.request('ai.agent.workspace.register', {
        path: workspacePath
      }),
    workspacePath
  )
  expect(registered).toMatchObject({ ok: true })
  const workspace = AgentWorkspaceEntitySchema.parse((registered as { data: unknown }).data)
  const response = await page.evaluate(
    ({ agentId, workspaceId, name }) =>
      window.api.dataApi.request({
        id: 'local-image-session',
        method: 'POST',
        path: '/agent-sessions',
        body: { agentId, name, workspace: { type: 'user', workspaceId } }
      }),
    { agentId: agent.id, workspaceId: workspace.id, name: sessionName }
  )
  expect(response.status).toBe(201)
  const session = AgentSessionEntitySchema.parse(response.data)
  await page.reload()
  await selectSidebarApp(page, 'Chat')
  const view = await openSession(page, agentName, sessionName)
  return { view, agentName, sessionName, sessionId: session.id }
}

async function attachFiles(app: ElectronApplication, page: Page, composer: Locator, files: string[]) {
  const original = await app.evaluateHandle(({ dialog }) => dialog.showOpenDialog)
  try {
    await app.evaluate(({ dialog }, files) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files })
    }, files)
    const upload = composer.getByRole('button', { name: 'Upload attachment', exact: true })
    if (await upload.isVisible()) await upload.click()
    else {
      await composer.getByRole('button', { name: 'Input Quick Panel', exact: true }).click()
      await page.getByRole('button', { name: /^Upload attachment\b/ }).click()
    }
    for (const file of files) await expect(composer.getByText(path.basename(file), { exact: true })).toBeVisible()
  } finally {
    await app.evaluate(({ dialog }, original) => {
      dialog.showOpenDialog = original
    }, original)
    await original.dispose()
  }
}

async function expectComposerImages(composer: Locator, files: string[]) {
  // Only tokens inside the editor survive draft serialization into attachment file parts.
  const tokens = composer
    .locator('[contenteditable="true"]')
    .first()
    .locator('[data-composer-token-node] [data-composer-token-kind="file"]')
  await expect(tokens, 'Image attachments must remain in the editor draft before sending').toHaveCount(files.length)
  for (const [index, file] of files.entries()) {
    const token = tokens.nth(index)
    await expect(token).toBeVisible()
    await expect(token).toContainText(path.basename(file))
    await expect(token).toHaveAttribute('data-file-token-variant', 'image')
    await expect(token.locator('[data-composer-token-remove]')).toBeEnabled()
  }
  await expect(composer.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
}

async function persistedMessages(page: Page, sessionId: string) {
  const result = await page.evaluate(
    (sessionId) =>
      window.api.dataApi.request({
        id: 'local-image-messages',
        method: 'GET',
        path: `/agent-sessions/${sessionId}/messages`
      }),
    sessionId
  )
  expect(result.status).toBe(200)
  return (result.data as { items: unknown[] }).items.map((item) => AgentSessionMessageEntitySchema.parse(item))
}

async function expectPersistedImageFiles(page: Page, sessionId: string, files: string[]) {
  await expect
    .poll(
      async () =>
        (await persistedMessages(page, sessionId))
          .filter((message) => message.role === 'user')
          .map((message) => (message.data.parts ?? []).filter((part) => part.type === 'file')),
      { message: 'Attachments did not enter the persisted user message as image file parts', timeout: 15_000 }
    )
    .toEqual([
      files.map((file) =>
        expect.objectContaining({
          type: 'file',
          filename: path.basename(file),
          mediaType: expect.stringMatching(/^image\//)
        })
      )
    ])
}

async function persistedErrors(page: Page, sessionId: string) {
  return (await persistedMessages(page, sessionId))
    .flatMap((message) => (message.role === 'assistant' ? (message.data.parts ?? []) : []))
    .filter((part) => part.type === 'data-error')
}

test('Pi Work sends two distinct local JPEGs to LM Studio and displays the reply', async ({
  electronApp,
  mainWindow
}, testInfo) => {
  test.setTimeout(180_000)
  const server = await startMockChatServer()
  try {
    const workspace = testInfo.outputPath('workspace')
    await mkdir(workspace, { recursive: true })
    const files = ['red.jpg', 'blue.jpg'].map((name) => path.join(workspace, name))
    for (const [index, background] of ['#ff0000', '#0000ff'].entries()) {
      await sharp({ create: { width: 8, height: 8, channels: 3, background } })
        .jpeg()
        .toFile(files[index])
    }
    const bytes = await Promise.all(files.map((file) => readFile(file)))
    expect(bytes[0].equals(bytes[1])).toBe(false)
    const { view, sessionId } = await createSession(mainWindow, server, workspace)
    const composer = uiLocator(view, 'chat.composer').filter({ visible: true }).first()
    const prompt = 'Compare the two local images.'
    await composer.locator('[contenteditable="true"]').first().click()
    await mainWindow.keyboard.type(prompt)
    await attachFiles(electronApp, mainWindow, composer, files)
    await expectComposerImages(composer, files)
    await view.getByRole('button', { name: 'Send', exact: true }).click()
    await expectPersistedImageFiles(mainWindow, sessionId, files)
    const request = await server.nextRequest(30_000)
    expect(request.body.model).toBe(server.modelId)
    await testInfo.attach('completion-request', {
      body: JSON.stringify(request.body, null, 2),
      contentType: 'application/json'
    })
    const users = request.body.messages
      .map((message) => message as { role?: string; content?: unknown })
      .filter((message) => message.role === 'user')
    expect(users).toHaveLength(1)
    expect(Array.isArray(users[0].content)).toBe(true)
    const parts = users[0].content as Array<{ type: string; text?: string; image_url?: { url: string } }>
    const images = parts.filter((part) => part.type === 'image_url')
    expect(images).toHaveLength(2)
    for (const [index, image] of images.entries()) {
      const url = image.image_url!.url
      // LM Studio's multi-image rule strips the data URL prefix; single-image requests retain it.
      expect(url).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
      expect(Buffer.from(url, 'base64')).toEqual(bytes[index])
    }
    const text = parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
    expect(text).toContain(prompt)
    for (const file of files) expect(text).not.toContain(file)
    const marker = 'LOCAL_IMAGES_OK'
    request.complete(marker)
    await expect(uiLocator(view, 'chat.message').filter({ hasText: marker })).toBeVisible({ timeout: 30_000 })
    await expect(uiLocator(view, 'chat.composer.action.pause')).toBeHidden()
    await expect(server.nextRequest(8000)).rejects.toThrow('Timed out waiting for a mock chat request')
    const screenshot = testInfo.outputPath('agent-local-images-turn.png')
    await mainWindow.screenshot({ path: screenshot })
    await testInfo.attach('agent-local-images-turn', { path: screenshot, contentType: 'image/png' })
  } finally {
    await server.close()
  }
})

test('Pi Work rejects an empty JPEG locally and persists the actionable named error', async ({
  electronApp,
  mainWindow
}, testInfo) => {
  test.setTimeout(180_000)
  const server = await startMockChatServer()
  try {
    const workspace = testInfo.outputPath('workspace')
    await mkdir(workspace, { recursive: true })
    const filename = 'empty-local-photo.jpg'
    const file = path.join(workspace, filename)
    // A nonexistent dialog path is rejected by FileStorage.statSync before reaching Pi.
    await writeFile(file, Buffer.alloc(0))
    const { view, agentName, sessionName, sessionId } = await createSession(mainWindow, server, workspace)
    const composer = uiLocator(view, 'chat.composer').filter({ visible: true }).first()
    await composer.locator('[contenteditable="true"]').first().click()
    await mainWindow.keyboard.type('Describe this image.')
    await attachFiles(electronApp, mainWindow, composer, [file])
    await expectComposerImages(composer, [file])
    await view.getByRole('button', { name: 'Send', exact: true }).click()
    await expectPersistedImageFiles(mainWindow, sessionId, [file])
    const error = uiLocator(view, 'chat.message').filter({ hasText: 'Could not prepare an image attachment.' })
    await expect(error).toContainText(filename)
    await expect(error).toContainText('is empty. Select the image again and retry.')
    await expect(server.nextRequest(8000)).rejects.toThrow('Timed out waiting for a mock chat request')
    await expect
      .poll(() => persistedErrors(mainWindow, sessionId), { timeout: 15_000 })
      .toEqual([
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'PiImagePreparationError',
            detailI18nKey: 'pi_image_empty_failed',
            detailI18nValues: { filename }
          })
        })
      ])
    await selectSidebarApp(mainWindow, 'Chat')
    await mainWindow.reload()
    const reopened = await openSession(mainWindow, agentName, sessionName)
    const restored = uiLocator(reopened, 'chat.message').filter({ hasText: 'Could not prepare an image attachment.' })
    await expect(restored).toContainText(filename)
    await expect(restored).toContainText('is empty. Select the image again and retry.')
    expect(await persistedErrors(mainWindow, sessionId)).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ detailI18nValues: { filename } }) })
    ])
    const screenshot = testInfo.outputPath('agent-local-image-error.png')
    await mainWindow.screenshot({ path: screenshot })
    await testInfo.attach('agent-local-image-error', { path: screenshot, contentType: 'image/png' })
  } finally {
    await server.close()
  }
})
