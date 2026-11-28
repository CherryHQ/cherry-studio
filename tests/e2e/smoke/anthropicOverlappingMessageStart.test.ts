import { copyFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'

import { MessageSchema } from '../../../src/shared/data/types/message'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { readTopicMessages } from '../regression/helpers/chat'
import { selectSidebarApp } from '../regression/helpers/navigation'
import { expect, test } from './fixtures/electron.fixture'

test('keeps a partial Anthropic response and its diagnostic when message_start overlaps', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(30_000)
  const profile = process.env.CS_DEV_PROFILE_ROOT
  expect(profile, 'Run with an isolated CS_DEV_PROFILE_ROOT').toBeTruthy()
  expect(path.isAbsolute(profile!), 'The isolated profile root must be absolute').toBe(true)

  const sse = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
  const start = (id: string) => ({
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-6',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 3, output_tokens: 0 }
    }
  })
  const frames = [
    sse('message_start', start('msg_A')),
    sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    sse('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'before' }
    }),
    sse('message_start', start('msg_B')),
    sse('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: ' after' }
    }),
    sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
    sse('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 2 }
    }),
    sse('message_stop', { type: 'message_stop' })
  ].join('')
  const requests: { method: string | undefined; url: string | undefined }[] = []
  const server = createServer((request, response) => {
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url })
      if (request.method !== 'POST' || !request.url?.endsWith('/messages')) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      response.end(frames)
    })
    request.resume()
  })
  const suffix = String(Date.now())
  const providerId = `anthropic-overlap-${suffix}`
  const assistantName = `Anthropic overlap ${suffix}`
  const diagnostic = 'Received message_start for message "msg_B" while message "msg_A" is still open.'
  const errors: string[] = []
  const onError = (error: Error) => errors.push(error.stack ?? error.message)
  page.on('pageerror', onError)
  const readPreferences = () =>
    page.evaluate(async () => ({
      language: await window.api.preference.get('app.language'),
      onboarding: await window.api.preference.get('app.onboarding.provider_setup.status'),
      naming: await window.api.preference.get('topic.naming.enabled'),
      privacy: await window.api.preference.get('app.privacy.policy_version')
    }))
  let previous: Awaited<ReturnType<typeof readPreferences>> | undefined
  let captured = false
  const screenshot = async (name: string) => {
    await page.bringToFront()
    // Let the foreground window paint before capturing evidence.
    await page.waitForTimeout(250)
    const output = testInfo.outputPath(name)
    await page.screenshot({ path: output })
    const evidence = path.resolve(
      process.env.TASKS ?? path.join(process.cwd(), '../.tasks/issue-23593'),
      'round-1/evidence'
    )
    await mkdir(evidence, { recursive: true })
    await copyFile(output, path.join(evidence, `${suffix}-${name}`))
    await testInfo.attach(name, { path: output, contentType: 'image/png' })
  }

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    previous = await readPreferences()
    await page.evaluate(async (policyVersion) => {
      await window.api.preference.set('app.language', 'en-US')
      await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
      await window.api.preference.set('topic.naming.enabled', false)
      await window.api.preference.set('app.privacy.policy_version', policyVersion)
    }, LATEST_PRIVACY_POLICY_VERSION)

    const responses = await page.evaluate(
      async ({ providerId, baseUrl, assistantName }) => {
        const created = await window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: `Anthropic relay ${providerId}`,
            defaultChatEndpoint: 'anthropic-messages',
            endpointConfigs: { 'anthropic-messages': { baseUrl } },
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
          body: [{ providerId, modelId: 'claude-opus-4-6', endpointTypes: ['anthropic-messages'] }]
        })
        const assistant = await window.api.dataApi.request({
          id: `${providerId}-assistant`,
          method: 'POST',
          path: '/assistants',
          body: { name: assistantName, modelId: `${providerId}::claude-opus-4-6` }
        })
        return [created.status, enabled.status, models.status, assistant.status]
      },
      { providerId, baseUrl, assistantName }
    )
    expect(responses, 'Seed the provider, enabled state, model and assistant through DataApi').toEqual([
      201, 200, 201, 201
    ])
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const view = page.locator('[data-ui~="chat.view"]:visible').first()
    const row = view.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await expect(row).toBeVisible({ timeout: 60_000 })
    await row.hover()
    await row.getByRole('button', { name: 'New Chat', exact: true }).click()
    const composer = view.locator('[data-ui~="chat.composer"]:visible')
    const editor = composer.locator('[contenteditable="true"]').first()
    await expect(editor).toBeEditable({ timeout: 30_000 })
    await editor.fill('Reply')
    const send = composer.getByRole('button', { name: 'Send', exact: true })
    await expect(send).toHaveAttribute('aria-disabled', 'false', { timeout: 30_000 })
    await send.click()
    await expect
      .poll(() => requests.filter(({ method, url }) => method === 'POST' && url === '/v1/messages').length, {
        message: 'The app must request the local Anthropic SSE fixture with POST /v1/messages',
        timeout: 30_000
      })
      .toBeGreaterThan(0)

    // The probe's assistant-role marker scopes assertions to this bubble, excluding the Detail portal.
    const assistant = view
      .locator('[data-ui~="chat.message"]:visible')
      .filter({ has: page.locator('.message-assistant') })
      .last()
    const description = assistant.getByText(/ended the response without a finish reason/)
    await expect(description).toBeVisible({ timeout: 60_000 })
    await expect(description).toContainText(/partial response was kept/, { timeout: 30_000 })
    await expect(description).not.toContainText(diagnostic, { timeout: 30_000 })
    await expect(assistant.getByText('before', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(assistant).not.toContainText(' after', { timeout: 30_000 })
    await expect(assistant).not.toContainText(diagnostic, { timeout: 30_000 })

    const messageId = await assistant.getAttribute('data-message-id')
    expect(messageId, 'The visible assistant bubble must identify its persisted message').toBeTruthy()
    const response = await page.evaluate(
      (id) => window.api.dataApi.request({ id: 'overlap-message', method: 'GET', path: `/messages/${id}` }),
      messageId!
    )
    expect(response.status).toBe(200)
    const { topicId } = MessageSchema.parse(response.data)
    await expect
      .poll(
        async () => {
          const messages = await readTopicMessages(page, topicId)
          const message = messages.find(({ id }) => id === messageId)
          return {
            role: message?.role,
            status: message?.status,
            text: message?.data.parts
              ?.filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('')
          }
        },
        { message: 'The exact assistant message must persist the error and retained partial text', timeout: 30_000 }
      )
      .toEqual({ role: 'assistant', status: 'error', text: 'before' })
    await screenshot('anthropic-overlap-conversation.png')

    await assistant.getByText('Detail', { exact: true }).click()
    const modal = page.getByRole('dialog', { name: 'Error Details', exact: true })
    await expect(modal).toBeVisible({ timeout: 30_000 })
    await expect(modal.getByText('Error Message', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(modal).toContainText(diagnostic, { timeout: 30_000 })
    await screenshot('anthropic-overlap-detail.png')
    captured = true
  } finally {
    try {
      if (!captured) await screenshot('anthropic-overlap-failure.png')
    } finally {
      try {
        await testInfo.attach('requests-and-errors', {
          body: JSON.stringify({ requests, errors, profile }, null, 2),
          contentType: 'application/json'
        })
      } finally {
        page.off('pageerror', onError)
        try {
          if (previous)
            await page.evaluate(async (values) => {
              await window.api.preference.set('app.language', values.language)
              await window.api.preference.set('app.onboarding.provider_setup.status', values.onboarding)
              await window.api.preference.set('topic.naming.enabled', values.naming)
              await window.api.preference.set('app.privacy.policy_version', values.privacy)
            }, previous)
        } finally {
          server.closeAllConnections()
          if (server.listening)
            await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
        }
      }
    }
  }
})
