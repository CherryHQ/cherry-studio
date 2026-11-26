import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { startTestHttpServer } from '@test-helpers/http/server'
import { generateText } from 'ai'
import { expect, it } from 'vitest'

import { GeminiMessageConverter } from '@main/features/apiGateway/adapters/converters/GeminiMessageConverter'

import { toModelMessages } from '../messageRules'

it('echoes a whitespace-only signature carrier on the native Gemini wire', async () => {
  const signed = { text: '\n \t', thoughtSignature: 'c2lnbmF0dXJl' }
  const answer = { text: 'Answer.' }
  const history = new GeminiMessageConverter().toUIMessages({
    contents: [
      { role: 'user', parts: [{ text: 'Question?' }] },
      { role: 'model', parts: [signed, { text: '\t' }, answer] },
      { role: 'user', parts: [{ text: 'Continue.' }] }
    ]
  })
  let received = ''
  const server = await startTestHttpServer(async (req, res) => {
    for await (const chunk of req) received += chunk.toString()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'OK' }] } }] }))
  })
  try {
    const messages = await toModelMessages(history, undefined, undefined, undefined, { wireDialect: 'google' })
    const google = createGoogleGenerativeAI({ baseURL: server.url, apiKey: 'fixture' })
    await generateText({ model: google('gemini-2.5-pro'), messages, maxRetries: 0 })
    expect(JSON.parse(received).contents[1]).toEqual({ role: 'model', parts: [signed, answer] })
  } finally {
    await server.close()
  }

  const anthropic = await toModelMessages(history, undefined, undefined, undefined, { wireDialect: 'anthropic' })
  expect(anthropic[1]).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: answer.text }] })
})
