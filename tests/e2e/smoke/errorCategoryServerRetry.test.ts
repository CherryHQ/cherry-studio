import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

import type { UnifiedPreferenceType } from '../../../src/shared/data/preference/preferenceTypes'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { type MockChatRequest, startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

test('Chat shows server retry guidance for a status-less streaming service failure', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(120_000)
  expect(process.env.CS_DEV_PROFILE_ROOT, 'Run with an isolated CS_DEV_PROFILE_ROOT').toBeTruthy()
  const server = await startMockChatServer()
  const suffix = `${Date.now()}`
  const providerId = `server-retry-${suffix}`
  const name = `Server retry ${suffix}`
  const marker = `SERVICE_FAILURE_${suffix}`
  const failure = 'Service temporarily unavailable. The model did not respond to this request.'
  let previous:
    | {
        language: UnifiedPreferenceType['app.language']
        onboarding: UnifiedPreferenceType['app.onboarding.provider_setup.status']
        naming: boolean
      }
    | undefined
  try {
    previous = await page.evaluate(async () => ({
      language: await window.api.preference.get('app.language'),
      onboarding: await window.api.preference.get('app.onboarding.provider_setup.status'),
      naming: await window.api.preference.get('topic.naming.enabled')
    }))
    const languageSelect = page.locator('[data-onboarding-language-select]')
    await expect(uiLocator(page, 'chat.composer').or(languageSelect).filter({ visible: true }).first()).toBeVisible()
    if (await languageSelect.isVisible()) {
      await languageSelect.getByRole('combobox').click()
      await page.getByRole('option', { name: 'English', exact: false }).click()
      await page.getByRole('button', { name: 'Set up later', exact: true }).click()
    }
    await page.evaluate(async () => {
      await window.api.preference.set('app.language', 'en-US')
      await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
      await window.api.preference.set('topic.naming.enabled', false)
    })
    await selectSidebarApp(page, 'Chat')
    const responses = await page.evaluate(
      async ({ providerId, baseUrl, modelId }) => {
        const created = await window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'Server retry mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-key', isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: `${providerId}-enable`,
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const models = await window.api.dataApi.request({
          id: `${providerId}-model`,
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        })
        return [created.status, enabled.status, models.status]
      },
      { providerId, baseUrl: server.baseUrl, modelId: server.modelId }
    )
    expect(responses, 'Provider and model must be available for real HTTP sends').toEqual([201, 200, 201])
    const created = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({ id: name, method: 'POST', path: '/assistants', body: { name, modelId } }),
      { name, modelId: createUniqueModelId(providerId, server.modelId) }
    )
    expect(created.status).toBe(201)
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const view = page.locator('[data-ui~="chat.view"]:visible')
    const row = view.locator('[data-ui~="chat.group-header"]').filter({ hasText: name }).first()
    await row.hover()
    await row.getByRole('button', { name: 'New Chat', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
    const composer = uiLocator(view, 'chat.composer').filter({ visible: true })
    await expect(composer).toHaveCount(1)
    const editor = composer.locator('[data-ui~="part:composer-input"] [contenteditable="true"]').first()
    await expect(editor).toBeEditable()
    await editor.fill(marker)
    const send = composer.getByRole('button', { name: 'Send', exact: true })
    await expect(send).toHaveAttribute('aria-disabled', 'false')
    await send.click()

    const messages = view.locator('[data-ui~="chat.message"]')
    const title = messages.getByText('Server error, please retry later', { exact: true })
    const deadline = Date.now() + 90_000
    let attempts = 0
    while (Date.now() < deadline && !(await title.isVisible())) {
      let request: MockChatRequest
      try {
        request = await server.nextRequest(Math.min(500, Math.max(1, deadline - Date.now())))
      } catch (error) {
        if (error instanceof Error && error.message === 'Timed out waiting for a mock chat request') continue
        throw error
      }
      if (!request.body.messages.some((message) => JSON.stringify(message).includes(marker))) {
        request.complete('unrelated')
        continue
      }
      expect(request.body.model).toBe(server.modelId)
      expect(request.body.stream, 'Only HTTP 200 SSE failures exercise the text diagnosis').toBe(true)
      attempts += 1
      expect(attempts, 'At most six correlated streaming attempts are allowed').toBeLessThanOrEqual(6)
      request.fail(failure)
    }
    expect(attempts, 'The composer must reach the real loopback server').toBeGreaterThan(0)
    await expect(title).toBeVisible()
    await expect(messages.getByText(failure, { exact: true })).toBeVisible()
  } finally {
    try {
      const screenshot = testInfo.outputPath('error-category-server.png')
      await page.screenshot({ path: testInfo.outputPath('error-category-server.png') })
      const evidence = '/Volumes/cherrydev/development/cherry-studio/worktrees/.tasks/issue-22181/round-1/evidence'
      await mkdir(evidence, { recursive: true })
      await copyFile(screenshot, path.join(evidence, 'error-category-server.png'))
      await testInfo.attach('error-category-server', { path: screenshot, contentType: 'image/png' })
    } finally {
      try {
        if (previous)
          await page.evaluate(async (values) => {
            await window.api.preference.set('app.language', values.language)
            await window.api.preference.set('app.onboarding.provider_setup.status', values.onboarding)
            await window.api.preference.set('topic.naming.enabled', values.naming)
          }, previous)
      } finally {
        await server.close()
      }
    }
  }
})
