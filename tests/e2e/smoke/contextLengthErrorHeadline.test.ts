import { createServer } from 'node:http'

import enUS from '../../../src/renderer/i18n/locales/en-us.json'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

test('numeric input overflow shows context recovery while generic HTTP 400 keeps its request headline', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(180_000)
  expect(process.env.CS_DEV_PROFILE_ROOT, 'Run with an isolated CS_DEV_PROFILE_ROOT').toBeTruthy()
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    let rawBody = ''
    for await (const chunk of request) rawBody += chunk.toString()
    const body = JSON.parse(rawBody) as { model: string }
    const message =
      body.model === 'mock-input-length'
        ? 'Input length 17063468 exceeds the maximum length 1048566'
        : 'Provider returned error'
    response.writeHead(400, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: { message, type: 'invalid_request_error' } }))
  })

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected loopback TCP address')
    const baseUrl = `http://127.0.0.1:${address.port}/v1`
    const providerId = `context-length-smoke-${Date.now()}`
    const modelIds = ['mock-input-length', 'mock-generic-400']
    const languageSelect = page.locator('[data-onboarding-language-select]')
    await expect(uiLocator(page, 'chat.composer').or(languageSelect).filter({ visible: true }).first()).toBeVisible()
    if (await languageSelect.isVisible()) {
      await languageSelect.getByRole('combobox').click()
      await page.getByRole('option', { name: 'English', exact: false }).click()
      await page.getByRole('button', { name: 'Set up later', exact: true }).click()
    }
    await selectSidebarApp(page, 'Chat')
    await page.evaluate(async (policyVersion) => {
      await window.api.preference.set('topic.naming.enabled', false)
      await window.api.preference.set('app.privacy.policy_version', policyVersion)
    }, LATEST_PRIVACY_POLICY_VERSION)
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'Context length smoke mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-key', isEnabled: true }]
          }
        }),
      { providerId, baseUrl }
    )
    expect(provider.status).toBe(201)
    const enabled = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: `${providerId}-enable`,
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        }),
      providerId
    )
    expect(enabled.status).toBe(200)
    const models = await page.evaluate(
      ({ providerId, modelIds }) =>
        window.api.dataApi.request({
          id: `${providerId}-models`,
          method: 'POST',
          path: '/models',
          body: modelIds.map((modelId) => ({ providerId, modelId, endpointTypes: ['openai-chat-completions'] }))
        }),
      { providerId, modelIds }
    )
    expect(models.status).toBe(201)
    for (const modelId of modelIds) {
      const assistant = await page.evaluate(
        ({ name, modelId }) =>
          window.api.dataApi.request({
            id: `${modelId}-assistant`,
            method: 'POST',
            path: '/assistants',
            body: { name, modelId }
          }),
        { name: `${providerId}-${modelId}`, modelId: createUniqueModelId(providerId, modelId) }
      )
      expect(assistant.status).toBe(201)
    }
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chatView = uiLocator(page, 'chat.view').filter({ visible: true }).first()
    await expect(chatView).toBeVisible()
    const messageList = page.locator('[data-ui~="chat.message-list"]').filter({ visible: true }).first()
    for (const modelId of modelIds) {
      const assistantRow = chatView
        .locator('[data-ui~="chat.group-header"]')
        .filter({ hasText: `${providerId}-${modelId}` })
        .first()
      await assistantRow.hover()
      await assistantRow.getByRole('button', { name: 'New Chat', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(modelId)
      const composer = uiLocator(page, 'chat.composer').filter({ visible: true }).first()
      const editor = composer.locator('[contenteditable="true"]').first()
      await editor.fill(`Check error headline ${modelId}`)
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(messageList).toBeVisible()
      const isContextLength = modelId === 'mock-input-length'
      if (isContextLength) {
        await expect(
          messageList.getByText(enUS['error.diagnosis.context_length'], { exact: true }).first()
        ).toBeVisible({
          timeout: 30_000
        })
        await expect(messageList.getByText(enUS['error.diagnosis.bad_request'], { exact: true })).toHaveCount(0)
      } else {
        await expect(messageList.getByText(enUS['error.diagnosis.bad_request'], { exact: true }).first()).toBeVisible({
          timeout: 30_000
        })
        await expect(messageList.getByText(enUS['error.diagnosis.context_length'], { exact: true })).toHaveCount(0)
      }
      const name = isContextLength ? 'after-context-length' : 'after-generic-400'
      const screenshot = testInfo.outputPath(`${name}.png`)
      await page.screenshot({ path: screenshot })
      await testInfo.attach(name, { path: screenshot, contentType: 'image/png' })
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
      server.closeAllConnections()
    })
  }
})
