import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { MessageSchema } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { sendChatMarker } from '../helpers/chat'
import { selectSidebarApp } from '../helpers/navigation'
import { openSettingsSection } from '../helpers/settings'
import type { RegressionApp } from '../RegressionApp'

export async function messageTokenDetails(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const providerId = `regression-mp39-${Date.now()}`
  const modelId = `mp39-metered-mock-${Date.now()}`
  const assistantName = app.resourceName('Token details assistant')
  const topicName = app.resourceName('Token details')
  const answer = 'MP39 completed response with measured token usage.'
  const namingEnabled = await page.evaluate(() => window.api.preference.get('topic.naming.enabled'))
  let assistantId: string | undefined
  const serverErrors: Error[] = []
  // Mock only the provider HTTP boundary; usage persistence and both UI surfaces remain real.
  testInfo.annotations.push({
    type: 'data-source',
    description:
      'Loopback mock chat replies and token usage; real Electron UI, IPC and persisted data. Does not validate external model quality.'
  })
  const server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
      expect(req.url).toBe('/v1/chat/completions')
      expect(body).toMatchObject({ model: modelId, stream: true })
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      res.flushHeaders()
      const send = (choices: unknown[], usage?: object) =>
        res.write(
          `data: ${JSON.stringify({
            id: 'chatcmpl-mp39',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: modelId,
            choices,
            ...(usage ? { usage } : {})
          })}\n\n`
        )
      send([{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }])
      await delay(250)
      send([{ index: 0, delta: { content: answer }, finish_reason: null }])
      await delay(500)
      send([{ index: 0, delta: {}, finish_reason: 'stop' }])
      send([], { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 })
      res.end('data: [DONE]\n\n')
    })().catch((error) => {
      serverErrors.push(error)
      res.destroy()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('MP-39 mock did not bind')

  try {
    await page.evaluate(() => window.api.preference.set('topic.naming.enabled', false))
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: 'mp39-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP39 usage mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
          }
        }),
      { providerId, baseUrl: `http://127.0.0.1:${address.port}/v1` }
    )
    expect(provider.status).toBe(201)
    const enabled = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: 'mp39-enable',
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
          id: 'mp39-model',
          method: 'POST',
          path: '/models',
          body: [
            {
              providerId,
              modelId,
              endpointTypes: ['openai-chat-completions'],
              pricing: {
                input: { perMillionTokens: 10, currency: 'USD' },
                output: { perMillionTokens: 20, currency: 'USD' }
              }
            }
          ]
        }),
      { providerId, modelId }
    )
    expect(models.status).toBe(201)
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'mp39-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, modelId) }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topic = await page.evaluate(
      ({ name, assistantId }) =>
        window.api.dataApi.request({
          id: 'mp39-topic',
          method: 'POST',
          path: '/topics',
          body: { name, assistantId }
        }),
      { name: topicName, assistantId }
    )
    expect(topic.status).toBe(201)
    const topicId = TopicSchema.parse(topic.data).id
    const old = await page.evaluate(
      (topicId) =>
        window.api.dataApi.request({
          id: 'mp39-old-message',
          method: 'POST',
          path: `/topics/${topicId}/messages`,
          body: {
            role: 'assistant',
            status: 'success',
            data: { parts: [{ type: 'text', text: 'MP39 old reply without statistics.', state: 'done' }] }
          }
        }),
      topicId
    )
    expect(old.status).toBe(201)
    const oldMessage = MessageSchema.parse(old.data)
    expect(oldMessage.stats?.inputTokens).toBeUndefined()
    expect(oldMessage.stats?.outputTokens).toBeUndefined()

    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    const group = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await expect(group).toBeVisible()
    await group.hover()
    const expand = group.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    await chat.getByTestId('topic-list-row').filter({ hasText: topicName }).click()
    const messageId = await sendChatMarker(page, 'Explain the token details briefly.', answer)
    expect(serverErrors).toEqual([])
    const reply = chat.locator(`[data-ui~="chat.message"][data-message-id="${messageId}"]`)
    await reply.getByRole('button', { name: /160 Tokens/ }).hover()
    const card = page.locator('[data-slot="hover-card-content"]:visible')
    await expect(card.getByTestId('message-metric-input')).toHaveText('Input120 Tokens')
    await expect(card.getByTestId('message-metric-output')).toHaveText('Output40 Tokens')
    const speedText = await card.getByTestId('message-metric-speed').locator('dd').innerText()
    expect(speedText).toMatch(/^[\d,.]+ Tokens\/s$/)
    const speed = Number(speedText.replace(/ Tokens\/s$/, '').replaceAll(',', ''))
    expect(speed).toBeGreaterThan(0)
    const secondary = card.getByTestId('message-secondary-metrics')
    const ttft = await secondary
      .locator('div')
      .filter({ has: page.locator('dt', { hasText: /^Time to first token$/ }) })
      .locator('dd')
      .innerText()
    expect(ttft).toMatch(/\d/)
    expect(ttft).not.toBe('0ms')
    await expect(card.getByTestId('message-cost')).toHaveText(/^CostEstimated\$0\.0020?$/)
    await card.getByRole('button', { name: 'More details', exact: true }).click()
    await expect(card.getByRole('button', { name: 'Less details', exact: true })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    await expect(card.getByTestId('message-performance-breakdown')).toBeVisible()
    await attachScreenshot('MP-39 completed reply token timing and estimated cost')
    await card.getByRole('button', { name: 'Less details', exact: true }).click()
    await expect(card.getByTestId('message-performance-breakdown')).toBeHidden()
    const composer = chat.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
    await composer.click()
    await composer.fill('MP39 composer remains accessible')
    await expect(composer).toHaveText('MP39 composer remains accessible')
    await expect(card).toBeHidden()
    await composer.fill('')

    await openSettingsSection(page, 'Usage')
    const row = page.getByRole('row').filter({ hasText: modelId }).filter({ hasText: assistantName })
    await expect(row).toHaveCount(1)
    const cells = row.getByRole('cell')
    await expect(cells.nth(3)).toHaveText('160')
    await expect(cells.nth(4)).toHaveText('$0.0020')
    await expect(cells.nth(5)).toHaveText(ttft)
    const usageSpeed = Number((await cells.nth(6).innerText()).replace(/ tok\/s$/, '').replaceAll(',', ''))
    // Message TPS rounds to one decimal; Usage rounds the same measured rate to an integer.
    expect(Math.abs(usageSpeed - speed)).toBeLessThanOrEqual(0.6)
    await row.scrollIntoViewIfNeeded()
    await attachScreenshot('MP-39 matching usage request')
    await testInfo.attach('MP-39 mock provider measurements', {
      body: JSON.stringify({
        source: 'loopback mock HTTP provider',
        inputTokens: 120,
        outputTokens: 40,
        ttft,
        speed,
        usageSpeed,
        estimatedUsd: 0.002
      }),
      contentType: 'application/json'
    })

    await selectSidebarApp(page, 'Chat')
    const oldReply = chat.locator(`[data-ui~="chat.message"][data-message-id="${oldMessage.id}"]`)
    await oldReply.scrollIntoViewIfNeeded()
    await expect(oldReply.getByText('MP39 old reply without statistics.', { exact: true })).toBeVisible()
    await attachScreenshot('MP-39 old reply missing statistics')
    // MessageTokens renders nothing when a message carries no stats object (MessageTokens.tsx), so a
    // reply without statistics must not expose a token-details trigger. The "—" placeholders belong to
    // messages that do have statistics but lack a single metric; the message data API projects stats
    // from usage records, so this suite cannot create that partial shape as a fixture.
    await expect(
      oldReply.getByRole('button', { name: /Tokens/ }),
      'A reply without statistics must not expose token details'
    ).toHaveCount(0)
    await composer.click()
    await expect(composer).toBeEditable()
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await page.evaluate(
      async ({ assistantId, providerId, namingEnabled }) => {
        await window.api.preference.set('topic.naming.enabled', namingEnabled)
        if (assistantId) {
          const permanentlyDeletedAssistant = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant.ok || !permanentlyDeletedAssistant.data.deleted)
            throw new Error('cleanup left the case assistant in the trash')
        }
        await window.api.dataApi.request({
          id: 'mp39-delete-provider',
          method: 'DELETE',
          path: `/providers/${providerId}`
        })
      },
      { assistantId, providerId, namingEnabled }
    )
  }
}
