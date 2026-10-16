import { test } from '@e2e-dev/web'
import { expect } from 'e2e'

import { chatProvider, data, openApp, persist, phase, sendMessage, startMockChatServer, storedMessage } from './helpers'

test(`retain a disconnected reply and recover after restart (${phase})`, async ({ app, agent, browser, screen }) => {
  const server = await startMockChatServer()
  const partial = `A partial rainbow explanation. ${data.marker}`
  try {
    await openApp(app, browser)
    if (phase === 'write') {
      await chatProvider(agent, browser, screen, server.baseUrl, `Recovery ${data.marker}`)
      await sendMessage(agent, browser, `Explain a rainbow. ${data.marker}`)
      const request = await server.nextRequest()
      expect(request.body).toMatchObject({ model: server.modelId, stream: true })
      request.sendText(partial)
      const response = browser.locator('[data-ui~="chat.message"][data-message-id]').filter({ hasText: partial }).last()
      await expect(response).toBeVisible()
      data.messageId = (await response.getAttribute('data-message-id'))!
      persist()
      request.disconnect()
    }
    const response = browser.locator(`[data-ui~="chat.message"][data-message-id="${data.messageId}"]`)
    await expect(response).toContainText(partial)
    await expect.poll(async () => (await storedMessage(browser, data.messageId!)).status).toBe('error')
    expect((await storedMessage(browser, data.messageId!)).data.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text', text: partial, state: 'done' })])
    )
    await expect(browser.locator('[data-ui~="chat.composer.action.pause"]')).toBeHidden()
    if (phase === 'read') {
      // The restarted test server has a new port; preserve the provider and its stored messages.
      const updatedStatus = await browser.evaluate(
        async ({ providerId, baseUrl }) => {
          const updated = await window.api.dataApi.request({
            id: 'agentic-endpoint',
            method: 'PATCH',
            path: `/providers/${providerId}`,
            body: { endpointConfigs: { 'openai-chat-completions': { baseUrl } } }
          })
          return updated.status
        },
        { providerId: data.providerId!, baseUrl: server.baseUrl }
      )
      expect(updatedStatus).toBe(200)
      await browser.reload()
      await expect(response).toContainText(partial)
      await sendMessage(agent, browser, `What happens next? ${data.marker}`)
      const request = await server.nextRequest()
      const answer = `The light leaves the raindrop. ${data.marker}`
      request.complete(answer)
      const recovery = browser.locator('[data-ui~="chat.message"][data-message-id]').filter({ hasText: answer }).last()
      await expect(recovery).toBeVisible()
      const id = (await recovery.getAttribute('data-message-id'))!
      await expect.poll(async () => (await storedMessage(browser, id)).status).toBe('success')
    }
    await app.screenshot(`chat-recovery-${phase}`)
  } finally {
    await server.close()
  }
})
