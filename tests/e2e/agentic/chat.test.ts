import { test } from '@e2e-dev/web'
import { expect } from 'e2e'

import { chatProvider, data, openApp, sendMessage, startMockChatServer, storedMessage } from './helpers'

test('configure a provider through the UI and persist its streamed reply', async ({ app, agent, browser, screen }) => {
  const server = await startMockChatServer()
  try {
    await openApp(app, browser)
    await chatProvider(agent, browser, screen, server.baseUrl, `Agentic ${data.marker}`)
    const prompt = `Explain a rainbow. ${data.marker}`
    await sendMessage(agent, browser, prompt)
    const request = await server.nextRequest()
    expect(request.body).toMatchObject({
      model: server.modelId,
      stream: true,
      messages: expect.arrayContaining([expect.objectContaining({ role: 'user', content: prompt })])
    })
    const answer = `Sunlight separates into colors. ${data.marker}`
    request.complete(process.env.AGENTIC_INJECT_FAILURE === '1' ? 'WRONG RESPONSE' : answer)
    const response = browser.locator('[data-ui~="chat.message"][data-message-id]').filter({ hasText: answer }).last()
    await expect(response).toBeVisible()
    const id = (await response.getAttribute('data-message-id'))!
    await expect.poll(async () => (await storedMessage(browser, id)).status).toBe('success')
    await app.screenshot('chat-success')
  } finally {
    await server.close()
  }
})
