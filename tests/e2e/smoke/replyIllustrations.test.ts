import { once } from 'node:events'
import { readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'

import { _electron as electron } from '@playwright/test'

import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test as base } from './fixtures/electron.fixture'

const test = base.extend({
  electronApp: async ({}, use, testInfo) => {
    const profile = testInfo.outputPath('profile')
    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profile },
      timeout: 60_000
    })
    try {
      await use(app)
    } finally {
      try {
        await app.close()
      } finally {
        await rm(profile, { recursive: true, force: true, maxRetries: 3 })
      }
    }
  }
})

// Catches failures between real prompt assembly, streaming, image dispatch, UI replacement and saved history.
test('preserves illustration settings, asynchronous images and prompt details across reloads', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(180_000)
  const chat = await startMockChatServer()
  const imageBase64 = (await readFile('build/icons/128x128.png')).toString('base64')
  const imageRequests: Array<{ prompt: string }> = []
  let finishImage: () => void = () => {
    throw new Error('No image request received')
  }
  const images = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || request.url !== '/v1/images/generations') {
        response.writeHead(404).end()
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      finishImage = () => {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            created: 1,
            data: [
              {
                b64_json: imageBase64
              }
            ]
          })
        )
      }
      imageRequests.push(body)
    })().catch(() => response.writeHead(500).end())
  })
  images.listen(0, '127.0.0.1')
  await once(images, 'listening')
  const address = images.address()
  if (!address || typeof address === 'string') throw new Error('Image fixture failed to bind')

  try {
    await page.evaluate(async (policyVersion) => {
      await window.api.preference.set('app.language', 'en-US')
      await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
      await window.api.preference.set('app.privacy.policy_version', policyVersion)
      await window.api.preference.set('topic.naming.enabled', false)
    }, LATEST_PRIVACY_POLICY_VERSION)
    await page.reload()
    await expect(page.locator('[data-ui~="app.shell"]').first()).toBeVisible({ timeout: 60_000 })
    await selectSidebarApp(page, 'Settings')
    await page
      .locator('[data-ui~="settings.navigation"]')
      .getByRole('button', { name: 'Appearance', exact: true })
      .click()
    const mode = page.getByRole('combobox', { name: 'Reply illustrations', exact: true })
    await expect(mode).toHaveText('Forced off')
    for (const [label, value] of [
      ['Automatic', 'auto'],
      ['Forced on', 'on'],
      ['Forced off', 'off'],
      ['Forced on', 'on']
    ]) {
      await mode.click()
      await page.getByRole('option', { name: label, exact: true }).click()
      await expect.poll(() => page.evaluate(() => window.api.preference.get('chat.illustration.mode'))).toBe(value)
      await expect(mode).toHaveText(label)
    }
    const maximum = page.getByRole('spinbutton', { name: 'Maximum illustrations per reply', exact: true })
    const exactCount = page.getByRole('switch', { name: 'Require exact count', exact: true })
    await expect(maximum).toHaveValue('1')
    await expect(exactCount).not.toBeChecked()
    await maximum.fill('2')
    await maximum.press('Enter')
    await expect.poll(() => page.evaluate(() => window.api.preference.get('chat.illustration.max_count'))).toBe(2)
    await exactCount.click()
    const target = page.getByRole('spinbutton', { name: 'Target count', exact: true })
    await target.fill('2')
    await target.press('Enter')
    await expect.poll(() => page.evaluate(() => window.api.preference.get('chat.illustration.target_count'))).toBe(2)
    await maximum.fill('1')
    await maximum.press('Enter')
    await expect.poll(() => page.evaluate(() => window.api.preference.get('chat.illustration.target_count'))).toBe(1)
    await page.reload()
    await expect(mode).toHaveText('Forced on')
    await expect(maximum).toHaveValue('1')
    await expect(exactCount).toBeChecked()
    await expect(target).toHaveValue('1')
    await mode.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('illustration-settings.png') })

    const providerId = 'reply-illustration-smoke'
    const assistantName = 'Illustration smoke'
    const setup = await page.evaluate(
      async ({ providerId, chatUrl, imageUrl, assistantName }) => {
        const request = (method: 'POST' | 'PATCH', path: string, body: unknown) =>
          window.api.dataApi.request({
            id: crypto.randomUUID(),
            method,
            path,
            body
          })
        const provider = await request('POST', '/providers', {
          providerId,
          name: 'Local illustration fixture',
          defaultChatEndpoint: 'openai-chat-completions',
          endpointConfigs: {
            'openai-chat-completions': { baseUrl: chatUrl },
            'openai-image-generation': { baseUrl: imageUrl }
          },
          apiKeys: [{ id: 'fixture', key: 'fixture', isEnabled: true }]
        })
        const enabled = await request('PATCH', `/providers/${providerId}`, { isEnabled: true })
        const models = await request('POST', '/models', [
          { providerId, modelId: 'mock-chat', endpointTypes: ['openai-chat-completions'] },
          {
            providerId,
            modelId: 'mock-image',
            endpointTypes: ['openai-image-generation'],
            capabilities: ['image-generation'],
            outputModalities: ['image']
          }
        ])
        const assistant = await request('POST', '/assistants', {
          name: assistantName,
          modelId: `${providerId}::mock-chat`
        })
        await window.api.preference.set('feature.paintings.default_model_id', `${providerId}::mock-image`)
        return [provider.status, enabled.status, models.status, assistant.status]
      },
      { providerId, chatUrl: chat.baseUrl, imageUrl: `http://127.0.0.1:${address.port}/v1`, assistantName }
    )
    expect(setup).toEqual([201, 200, 201, 201])
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const assistant = page.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await assistant.hover()
    await assistant.getByRole('button', { name: 'New Chat', exact: true }).click()
    await page
      .locator('[data-ui~="chat.composer"]:visible [contenteditable="true"]')
      .first()
      .fill('Explain a bird with an illustration.')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const reply = await chat.nextRequest()
    expect(JSON.stringify(reply.body.messages)).toContain('You must include exactly 1 illustration in each reply.')
    reply.sendText('Before illustration\n[[IMAGE]]')
    const status = page.getByRole('status').filter({ hasText: 'Generating illustration' })
    await expect(status).toBeVisible()
    expect(imageRequests).toHaveLength(0)
    const answer = page.locator('[data-ui~="part:message-content"]').filter({
      has: page.getByText('Before illustration', { exact: true })
    })
    const imagePrompt = 'A **bird** on a branch\nWatercolor style'
    reply.complete(`${imagePrompt}[[/IMAGE]]\nAfter illustration`)
    await expect(page.getByText('After illustration', { exact: true })).toBeVisible()
    await expect(status).toBeVisible()
    const promptText = page.getByText(imagePrompt, { exact: true })
    await expect(promptText).toHaveCount(0)
    await expect.poll(() => imageRequests.length).toBe(1)
    expect(imageRequests[0].prompt).toBe(imagePrompt)
    await page.getByRole('button', { name: 'Show prompt', exact: true }).click()
    await expect(promptText).toBeVisible()
    expect(await promptText.textContent()).toBe(imagePrompt)
    await page.getByRole('button', { name: 'Hide prompt', exact: true }).click()
    await expect(promptText).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('illustration-placeholder.png') })
    finishImage()
    const image = answer.locator('img')
    await expect(image).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0))
      .toBe(true)
    await expect(status).toHaveCount(0)
    await page.getByRole('button', { name: 'Show prompt', exact: true }).click()
    await expect(promptText).toBeVisible()
    expect(await promptText.textContent()).toBe(imagePrompt)
    await page.getByRole('button', { name: 'Hide prompt', exact: true }).click()
    const before = await page.getByText('Before illustration', { exact: true }).boundingBox()
    const picture = await image.boundingBox()
    const after = await page.getByText('After illustration', { exact: true }).boundingBox()
    expect(before!.y).toBeLessThan(picture!.y)
    expect(picture!.y).toBeLessThan(after!.y)
    await page.reload()
    await expect(image).toBeVisible()
    await expect
      .poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0))
      .toBe(true)
    expect(imageRequests).toHaveLength(1)
    await expect(promptText).toHaveCount(0)
    await page.getByRole('button', { name: 'Show prompt', exact: true }).click()
    await expect(promptText).toBeVisible()
    expect(await promptText.textContent()).toBe(imagePrompt)
    await page.screenshot({ path: testInfo.outputPath('illustration-saved.png') })
  } finally {
    await chat.close()
    images.closeAllConnections()
    await new Promise<void>((resolve, reject) => images.close((error) => (error ? reject(error) : resolve())))
  }
})
