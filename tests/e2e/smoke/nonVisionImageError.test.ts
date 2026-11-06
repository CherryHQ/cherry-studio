import sharp from 'sharp'

import en from '../../../src/renderer/i18n/locales/en-us.json'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/helpers/navigation'
import { expect, test } from './fixtures/electron.fixture'

test('normal Chat shows attachment guidance for an image sent to a non-vision model', async ({
  electronApp,
  mainWindow: page
}, testInfo) => {
  test.setTimeout(180_000)
  expect(process.env.CS_DEV_PROFILE_ROOT, 'Run with an isolated CS_DEV_PROFILE_ROOT').toBeTruthy()
  const server = await startMockChatServer()

  try {
    const providerId = `non-vision-image-${Date.now()}`
    const providerDisplayName = 'Non-vision image smoke mock'
    const modelId = 'deepseek-v4-flash'
    const assistantName = `Non-vision image ${providerId}`
    const fixtureFileName = 'non-vision-image.png'
    const fixturePath = testInfo.outputPath(fixtureFileName)
    await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123456' } })
      .png()
      .toFile(fixturePath)

    await page.waitForFunction(() => !!window.api?.preference, undefined, { timeout: 60_000 })
    await page.evaluate(async (policyVersion) => {
      await window.api.preference.setMultiple({
        'app.language': 'en-US',
        'app.privacy.policy_version': policyVersion,
        'app.onboarding.provider_setup.status': 'skipped',
        'menu.presentation_mode': 'cherry',
        'topic.naming.enabled': false
      })
    }, LATEST_PRIVACY_POLICY_VERSION)
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    expect(
      await page.evaluate(() => window.api.preference.get('feature.file_processing.default_image_to_text'))
    ).toBeNull()

    const provider = await page.evaluate(
      ({ providerId, providerDisplayName, baseUrl }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: providerDisplayName,
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-key', isEnabled: true }]
          }
        }),
      { providerId, providerDisplayName, baseUrl: server.baseUrl }
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
      ({ providerId, modelId }) =>
        window.api.dataApi.request({
          id: `${providerId}-model`,
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        }),
      { providerId, modelId }
    )
    expect(models.status).toBe(201)
    const assistant = await page.evaluate(
      ({ providerId, name, modelId }) =>
        window.api.dataApi.request({
          id: `${providerId}-assistant`,
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { providerId, name: assistantName, modelId: createUniqueModelId(providerId, modelId) }
    )
    expect(assistant.status).toBe(201)
    await page.reload()

    const chatView = page.locator('[data-ui~="chat.view"]').filter({ visible: true })
    await expect(chatView).toBeVisible({ timeout: 60_000 })
    const assistantRow = chatView.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await assistantRow.hover()
    await assistantRow.getByRole('button', { name: 'New Chat', exact: true }).click()
    await expect(chatView.getByRole('button', { name: 'Selected models', exact: true })).toContainText(
      providerDisplayName
    )

    const composer = chatView.locator('[data-ui~="chat.composer"]').filter({ visible: true }).first()
    const boundary = composer.locator('[data-ui~="part:composer-input"]').filter({ visible: true })
    const editor = boundary
      .and(page.locator('textarea'))
      .or(boundary.locator('[contenteditable="true"]'))
      .filter({ visible: true })
      .first()
    await expect(editor).toBeVisible()
    await editor.fill('Describe the attached image.')

    const originalDialog = await electronApp.evaluateHandle(({ dialog }) => dialog.showOpenDialog)
    try {
      await electronApp.evaluate(({ dialog }, filePath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
      }, fixturePath)
      const launcher = composer.getByRole('button', { name: 'Upload attachment', exact: true })
      if (await launcher.isVisible()) {
        await launcher.click()
      } else {
        await composer.getByRole('button', { name: 'Input Quick Panel', exact: true }).click()
        await page.getByRole('button', { name: /^Upload attachment\b/ }).click()
      }
      await expect(composer.getByText(fixtureFileName, { exact: true })).toBeVisible({ timeout: 30_000 })
    } finally {
      try {
        await electronApp.evaluate(({ dialog }, original) => {
          dialog.showOpenDialog = original
        }, originalDialog)
      } finally {
        await originalDialog.dispose()
      }
    }

    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const guidance = en['error.image_unreadable_for_non_vision_model']
    const notifications = page.getByRole('region', { name: 'notifications' })
    const toast = notifications.getByRole('alert')
    await expect(toast).toBeVisible()
    await expect(toast).toContainText(guidance)
    await expect(toast).not.toContainText(en['error.diagnosis.ocr'])
    await expect(toast).not.toContainText(en['error.diagnosis.unknown'])
    const errorBlock = chatView.locator('[data-ui~="chat.message-error-info"]').filter({ hasText: guidance })
    await expect(errorBlock).toHaveCount(1)
    await expect.poll(async () => (await errorBlock.innerText()).split(guidance).length - 1).toBe(1)
    await expect(composer.getByText(fixtureFileName, { exact: true })).toHaveCount(0)
    const headline = chatView.getByText(en['error.image_unreadable_for_non_vision_model'], { exact: true })
    await expect(headline).toBeVisible({ timeout: 60_000 })
    await expect(chatView.getByText(en['error.diagnosis.unknown'], { exact: true })).not.toBeVisible()
    await expect(chatView.getByText(en['error.diagnosis.ocr'], { exact: true })).not.toBeVisible()

    await page.bringToFront()
    await page.waitForTimeout(250)
    await expect(headline).toBeVisible()
    const screenshotPath = testInfo.outputPath('non-vision-image-guidance.png')
    await page.screenshot({ path: screenshotPath })
    await testInfo.attach('non-vision-image-guidance', { path: screenshotPath, contentType: 'image/png' })
    // The helper exposes only nextRequest(), with no cumulative request count or history.
    // Skip the zero-request assertion rather than infer a count from its transient queue.
    await testInfo.attach('non-vision-image-observation', {
      body: `Observed headline: ${await headline.innerText()}\nMock-server chat request count: unavailable (helper exposes no count/history; zero-request assertion skipped).\n`,
      contentType: 'text/plain'
    })
  } finally {
    await server.close()
  }
})
