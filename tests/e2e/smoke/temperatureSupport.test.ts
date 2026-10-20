import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { _electron as electron } from '@playwright/test'
import * as z from 'zod'

import { AssistantSchema } from '../../../src/shared/data/types/assistant'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { ProviderSchema } from '../../../src/shared/data/types/provider'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { expect, test as base } from './fixtures/electron.fixture'

const test = base.extend<{ isolatedProfile: string }>({
  // Playwright requires object destructuring for fixture dependencies.
  // oxlint-disable-next-line no-empty-pattern
  isolatedProfile: async ({}, use) => {
    const previous = process.env.CS_DEV_PROFILE_ROOT
    const profile = await mkdtemp(path.join(tmpdir(), 'issue-21970-'))
    process.env.CS_DEV_PROFILE_ROOT = profile
    try {
      await use(profile)
    } finally {
      if (previous === undefined) delete process.env.CS_DEV_PROFILE_ROOT
      else process.env.CS_DEV_PROFILE_ROOT = previous
      await rm(profile, { recursive: true, force: true })
    }
  },
  electronApp: async ({ isolatedProfile }, use) => {
    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: isolatedProfile },
      timeout: 60_000
    })
    try {
      await use(app)
    } finally {
      await app.close()
    }
  }
})

for (const [apiModelId, supported] of [
  ['openai/gpt-5.6-terra', false],
  ['gpt-4o', true]
] as const) {
  test(`CherryIN ${apiModelId} temperature support reaches the HTTP body`, async ({ mainWindow: page }, testInfo) => {
    test.setTimeout(120_000)
    const server = await startMockChatServer()
    const marker = `temperature-${apiModelId}-${Date.now()}`
    try {
      const languageSelect = page.locator('[data-onboarding-language-select]')
      await expect(languageSelect.or(page.locator('[data-ui~="ui.sidebar"]')).first()).toBeVisible({
        timeout: 60_000
      })
      if (await languageSelect.isVisible().catch(() => false)) {
        await languageSelect.getByRole('combobox').click()
        await page.getByRole('option', { name: 'English', exact: false }).click()
        await page.getByRole('button', { name: 'Set up later', exact: true }).click()
      }
      await page.evaluate(async () => {
        await window.api.preference.set('app.language', 'en-US')
        await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
        await window.api.preference.set('topic.naming.enabled', false)
      })
      const setup = await page.evaluate(
        async ({ baseUrl, apiModelId }) => {
          const seeded = await window.api.dataApi.request({
            id: 'get-cherryin',
            method: 'GET',
            path: '/providers/cherryin'
          })
          const providerId = seeded.status === 200 ? 'cherryin' : 'issue-21970-cherryin'
          if (seeded.status !== 200 && seeded.status !== 404) throw new Error(JSON.stringify(seeded))
          if (seeded.status === 404) {
            const created = await window.api.dataApi.request({
              id: 'create-cherryin',
              method: 'POST',
              path: '/providers',
              body: {
                providerId,
                presetProviderId: 'cherryin',
                name: 'Issue 21970',
                defaultChatEndpoint: 'openai-chat-completions',
                endpointConfigs: { 'openai-chat-completions': { baseUrl } },
                apiKeys: [{ id: 'mock', key: 'mock', isEnabled: true }]
              }
            })
            if (created.status !== 201) throw new Error(JSON.stringify(created))
          }
          const enabled = await window.api.dataApi.request({
            id: 'enable-cherryin',
            method: 'PATCH',
            path: `/providers/${providerId}`,
            body: {
              isEnabled: true,
              defaultChatEndpoint: 'openai-chat-completions',
              endpointConfigs: { 'openai-chat-completions': { baseUrl } }
            }
          })
          if (enabled.status !== 200) throw new Error(JSON.stringify(enabled))
          const addedKey = await window.api.dataApi.request({
            id: 'add-cherryin-api-key',
            method: 'POST',
            path: `/providers/${providerId}/api-keys`,
            body: { key: 'mock-key', label: 'mock' }
          })
          if (addedKey.status !== 201) throw new Error(JSON.stringify(addedKey))
          const created = await window.api.dataApi.request({
            id: 'create-model',
            method: 'POST',
            path: '/models',
            body: [{ providerId, modelId: apiModelId, endpointTypes: ['openai-chat-completions'] }]
          })
          if (created.status !== 201) throw new Error(JSON.stringify(created))
          const models = await window.api.dataApi.request({
            id: 'read-models',
            method: 'GET',
            path: '/models',
            params: { providerId }
          })
          if (models.status !== 200) throw new Error(JSON.stringify(models))
          return {
            providerId,
            branch: seeded.status === 200 ? 'seeded' : 'created',
            provider: enabled.data,
            models: models.data
          }
        },
        { baseUrl: server.baseUrl, apiModelId }
      )
      await testInfo.attach('provider-branch-and-models', {
        body: JSON.stringify(setup),
        contentType: 'application/json'
      })
      const provider = ProviderSchema.parse(setup.provider)
      expect(provider.presetProviderId).toBe('cherryin')
      expect(provider.endpointConfigs?.['openai-chat-completions']?.adapterFamily).toBe('cherryin')
      const rowSchema = z.object({
        id: z.string(),
        apiModelId: z.string().optional(),
        parameterSupport: z
          .looseObject({ temperature: z.object({ supported: z.boolean().optional() }).optional() })
          .optional()
      })
      const model = z
        .array(rowSchema)
        .parse(setup.models)
        .find((row) => row.apiModelId === apiModelId)
      expect(model).toBeDefined()
      expect(model?.apiModelId).toBe(apiModelId)
      expect(model?.id).toBe(createUniqueModelId(setup.providerId, apiModelId))
      if (supported) expect(model?.parameterSupport?.temperature?.supported).not.toBe(false)
      else expect(model?.parameterSupport?.temperature?.supported).toBe(false)

      const createdAssistant = await page.evaluate(
        ({ name, modelId }) =>
          window.api.dataApi.request({
            id: name,
            method: 'POST',
            path: '/assistants',
            body: { name, modelId }
          }),
        { name: marker, modelId: createUniqueModelId(setup.providerId, apiModelId) }
      )
      expect(createdAssistant.status).toBe(201)
      const assistant = AssistantSchema.parse(createdAssistant.data)
      const configured = await page.evaluate(
        (id) =>
          window.api.dataApi.request({
            id: 'configure-temperature-assistant',
            method: 'PATCH',
            path: `/assistants/${id}`,
            body: { settings: { enableTemperature: true, temperature: 0.7 } }
          }),
        assistant.id
      )
      expect(configured.status).toBe(200)
      await page.reload()
      await page.waitForTimeout(2500)
      await page.getByRole('button', { name: 'Chat', exact: true }).first().click()
      await page.waitForTimeout(1500)
      const view = page.locator('[data-ui~="chat.view"]:visible').first()
      const row = view.locator('[data-ui~="chat.group-header"]').filter({ hasText: marker }).first()
      await expect(row).toBeVisible({ timeout: 20_000 })
      await row.hover()
      await row.getByRole('button', { name: 'New Chat', exact: true }).first().click()
      const composer = view.locator('[data-ui~="chat.composer"]:visible').first()
      const editor = composer.locator('[data-ui~="part:composer-input"] [contenteditable="true"]').first()
      await expect(editor).toBeEditable()
      await editor.fill(marker)
      const send = composer.getByRole('button', { name: 'Send', exact: true })
      await expect(send).toHaveAttribute('aria-disabled', 'false')
      await send.click()
      const deadline = Date.now() + 30_000
      while (true) {
        const request = await server.nextRequest(Math.max(1, deadline - Date.now()))
        if (!JSON.stringify(request.body.messages).includes(marker)) {
          request.complete('unrelated')
          if (Date.now() >= deadline) throw new Error('No correlated chat request')
          continue
        }
        const body = request.body
        await testInfo.attach(`${apiModelId}-chat-body`, {
          body: JSON.stringify(body),
          contentType: 'application/json'
        })
        expect(body.stream).toBe(true)
        expect(body.model).toBe(apiModelId)
        expect(Object.hasOwn(body, 'temperature')).toBe(supported)
        if (supported) expect(body.temperature).toBeCloseTo(0.7)
        request.complete(`reply-${marker}`)
        break
      }
      await expect(
        view
          .locator('[data-ui~="chat.message"]')
          .filter({ hasText: `reply-${marker}` })
          .first()
      ).toBeVisible({
        timeout: 30_000
      })
      const screenshot = testInfo.outputPath(`temperature-support-${apiModelId}.png`)
      await page.screenshot({ path: screenshot })
      await testInfo.attach(`temperature-support-${apiModelId}`, { path: screenshot, contentType: 'image/png' })
    } finally {
      await server.close()
    }
  })
}
