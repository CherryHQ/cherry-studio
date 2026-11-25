import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { generateText, readUIMessageStream, streamText, type ModelMessage, type UIMessage, wrapLanguageModel } from 'ai'
import { expect, it } from 'vitest'

import { toModelMessages } from '../../../../../messages/messageRules'
import { createOpenrouterReasoningMiddleware } from '../openrouterReasoning'

it.each(['generate', 'stream'])('replays OpenRouter ciphertext from a tool-free %s response', async (mode) => {
  const detail = { type: 'reasoning.encrypted', id: 'reasoning-1', format: 'anthropic-claude-v1', data: 'ciphertext' }
  const requests: unknown[] = []
  const modelId = 'anthropic/claude-fixture'
  const base = { id: 'response-1', created: 1, model: modelId }
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)))
    const response = { role: 'assistant', content: 'Visible reply', reasoning_details: [detail] }
    if (mode === 'stream' && requests.length === 1) {
      const chunks = [
        { delta: { reasoning_details: [detail] }, finish_reason: null },
        { delta: { content: response.content }, finish_reason: null },
        { delta: {}, finish_reason: 'stop' }
      ].map((choice) => 'data: ' + JSON.stringify({ ...base, choices: [{ index: 0, ...choice }] }) + '\n\n')
      return new Response(chunks.join('') + 'data: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' }
      })
    }
    return Response.json({
      ...base,
      choices: [{ index: 0, message: response, finish_reason: 'stop' }]
    })
  }
  const model = wrapLanguageModel({
    model: createOpenRouter({ apiKey: 'fixture', baseURL: 'https://fixture.invalid/api/v1', fetch })(modelId),
    middleware: createOpenrouterReasoningMiddleware()
  })
  const first = { model, prompt: 'Question', maxRetries: 0 }
  let messages: ModelMessage[]
  if (mode === 'stream') {
    let reply: UIMessage | undefined
    for await (const message of readUIMessageStream({ stream: streamText(first).toUIMessageStream() })) {
      reply = message
    }
    if (!reply) throw new Error('Expected an assistant reply')
    messages = await toModelMessages([JSON.parse(JSON.stringify(reply))])
  } else {
    const result = await generateText(first)
    messages = result.response.messages
  }
  await generateText({
    model,
    messages: [{ role: 'user', content: 'Question' }, ...messages, { role: 'user', content: 'Follow-up' }],
    maxRetries: 0
  })
  expect(requests).toHaveLength(2)
  expect(requests[1]).toMatchObject({
    messages: expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', content: 'Visible reply', reasoning_details: [detail] })
    ])
  })
})
