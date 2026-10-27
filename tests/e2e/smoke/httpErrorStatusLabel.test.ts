import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { _electron as electron, type ElectronApplication } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { MessageSchema } from '@shared/data/types/message'
import { createUniqueModelId, ENDPOINT_TYPE } from '@shared/data/types/model'
import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'

import { selectSidebarApp } from '../regression/navigation'
import { expect, test as base } from './fixtures/electron.fixture'

const test = base.extend({
  electronApp: async ({}, use, testInfo) => {
    const profileRoot = await mkdtemp(testInfo.outputPath('profile-'))
    let electronApp: ElectronApplication | undefined
    try {
      electronApp = await electron.launch({
        args: ['.'],
        env: {
          ...process.env,
          NODE_ENV: 'development',
          CS_DEV_PROFILE_ROOT: profileRoot,
          CSLOGGER_RENDERER_LEVEL: 'silly',
          CSLOGGER_RENDERER_SHOW_MODULES: ''
        },
        timeout: 60_000
      })
      await use(electronApp)
    } finally {
      try {
        await electronApp?.close()
      } finally {
        await rm(profileRoot, { recursive: true, force: true, maxRetries: 3 })
      }
    }
  }
})

test('a real HTTP 413 shows localized size guidance and the provider diagnostic', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(120_000)
  const consoleOutput: string[] = []
  page.on('console', (message) => consoleOutput.push(message.text()))
  const requests: unknown[] = []
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      requests.push(JSON.parse(body))
      response.writeHead(413, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          error: {
            message: 'Fixture request exceeds size limit',
            type: 'request_too_large',
            code: 'payload_too_large'
          }
        })
      )
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const providerId = `http-413-${crypto.randomUUID()}`
  const modelId = 'http-413-fixture'
  const assistantName = `HTTP 413 ${providerId}`
  const prompt = 'Check the HTTP 413 status label'
  let providerCreated = false
  let assistantId: string | undefined
  try {
    await page.evaluate(async (privacyVersion) => {
      await window.api.preference.set('app.language', 'en-US')
      await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
      await window.api.preference.set('app.privacy.policy_version', privacyVersion)
      await window.api.preference.set('topic.naming.enabled', false)
      await window.api.preference.set('chat.retry.enabled', false)
      await window.api.preference.set('chat.retry.fallback_model_ids', [])
    }, LATEST_PRIVACY_POLICY_VERSION)
    await page.reload()
    await expect(page.locator('[data-ui~="app.shell"]').first()).toBeVisible()

    const provider = await page.evaluate(
      ({ providerId, baseUrl, endpointType }) =>
        window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            presetProviderId: 'lmstudio',
            name: 'HTTP 413 fixture',
            defaultChatEndpoint: endpointType,
            endpointConfigs: { [endpointType]: { baseUrl } }
          }
        }),
      { providerId, baseUrl, endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS }
    )
    providerCreated = provider.status === 201
    expect(provider.status, JSON.stringify(provider.error)).toBe(201)
    expect(provider.data).toMatchObject({
      presetProviderId: 'lmstudio',
      endpointConfigs: {
        'openai-chat-completions': { baseUrl, adapterFamily: 'openai-compatible' }
      }
    })
    const key = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: `/providers/${providerId}/api-keys`,
          body: { key: 'http-413-dummy-key' }
        }),
      providerId
    )
    expect(key.status, JSON.stringify(key.error)).toBe(201)
    const enabled = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        }),
      providerId
    )
    expect(enabled.status, JSON.stringify(enabled.error)).toBe(200)
    const models = await page.evaluate(
      ({ providerId, modelId, endpointType }) =>
        window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: [endpointType] }]
        }),
      { providerId, modelId, endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS }
    )
    expect(models.status, JSON.stringify(models.error)).toBe(201)
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, modelId) }
    )
    expect(assistant.status, JSON.stringify(assistant.error)).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id

    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const view = page.locator('[data-ui~="chat.view"]:visible')
    const row = view.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await row.hover()
    await row.getByRole('button', { name: 'New Chat', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(modelId)
    const composer = view.locator('[data-ui~="chat.composer"]:visible')
    const editor = composer.locator('[data-ui~="part:composer-input"] [contenteditable="true"]').first()
    await expect(editor).toBeEditable()
    await editor.fill(prompt)
    const send = composer.locator('[data-ui~="chat.composer.action.send"]')
    await expect(send).toHaveAttribute('aria-disabled', 'false')
    await send.click()

    await expect
      .poll(() => requests)
      .toContainEqual(
        expect.objectContaining({
          model: modelId,
          stream: true,
          messages: expect.arrayContaining([expect.objectContaining({ role: 'user', content: prompt })])
        })
      )
    const errorMessage = view
      .locator('[data-ui~="chat.message"][data-message-id]')
      .filter({ hasText: 'Fixture request exceeds size limit' })
      .last()
    await expect(errorMessage).toBeVisible()
    const messageId = await errorMessage.getAttribute('data-message-id')
    if (!messageId) throw new Error('The error response has no message ID')
    await expect
      .poll(async () => {
        const stored = await page.evaluate(
          (id) => window.api.dataApi.request({ id: crypto.randomUUID(), method: 'GET', path: `/messages/${id}` }),
          messageId
        )
        expect(stored.status).toBe(200)
        return MessageSchema.parse(stored.data)
      })
      .toMatchObject({
        status: 'error',
        data: {
          parts: expect.arrayContaining([
            expect.objectContaining({ type: 'data-error', data: expect.objectContaining({ statusCode: 413 }) })
          ])
        }
      })
    await expect(errorMessage).toContainText(
      'Request body too large. Reduce the size of the message, attachment or conversation history and try again Fixture request exceeds size limit'
    )
    const screenshotPath = testInfo.outputPath('http-413-status-label.png')
    await page.screenshot({ path: screenshotPath })
    await testInfo.attach('http-413-status-label', { path: screenshotPath, contentType: 'image/png' })
    expect(consoleOutput.filter((text) => /Missing key:? 413\b/.test(text))).toEqual([])
  } finally {
    try {
      if (assistantId) {
        const deleted = await page.evaluate(
          (assistantId) =>
            window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true }),
          assistantId
        )
        expect(deleted).toMatchObject({ ok: true })
      }
    } finally {
      try {
        if (providerCreated) {
          const deleted = await page.evaluate(
            (providerId) =>
              window.api.dataApi.request({
                id: crypto.randomUUID(),
                method: 'DELETE',
                path: `/providers/${providerId}`
              }),
            providerId
          )
          expect(deleted.status).toBe(204)
        }
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        })
      }
    }
  }
})
