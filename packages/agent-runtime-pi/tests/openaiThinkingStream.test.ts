import { stream } from '@earendil-works/pi-ai/api/openai-completions'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { expect, it } from 'vitest'

import { MODEL } from './sessionSupport'

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const details = [{ type: 'reasoning.encrypted', data: 'opaque-replay-data' }]
const encryptedContent = 'opaque-ciphertext'

it.each([
  {
    replay: 'reasoning_details',
    sendEncryptedContent: false,
    signature: JSON.stringify(details)
  },
  {
    replay: 'reasoning_details and encrypted_content',
    sendEncryptedContent: true,
    signature: JSON.stringify({ encrypted_content: encryptedContent, reasoning_details: details })
  }
])('ends thinking before output and retains late $replay', async (fixture) => {
  const { sendEncryptedContent, signature } = fixture
  const firstAnswer = gate()
  const finish = gate()
  const chunk = (delta: object, finishReason: 'tool_calls' | null = null) => ({
    id: 'response',
    object: 'chat.completion.chunk' as const,
    created: 0,
    model: MODEL.id,
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  })
  const reply = stream(
    { ...MODEL, api: 'openai-completions' },
    normalizeContext({ messages: [{ role: 'user', content: 'Answer and use a tool.', timestamp: 0 }] }),
    {
      apiKey: 'fixture-key',
      objectTransports: {
        'openai-completions': async () => ({
          status: 200,
          headers: new Headers(),
          events: (async function* () {
            yield chunk({ reasoning_content: 'First thought' })
            yield chunk({ content: '' })
            yield chunk({ reasoning_content: ' continues.', content: 'First answer.' })
            await firstAnswer.promise
            yield chunk({ reasoning_details: details })
            yield chunk({ reasoning_content: 'Second thought.' })
            yield chunk({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'echo', arguments: '{}' } }] })
            await finish.promise
            if (sendEncryptedContent) yield chunk({ encrypted_content: encryptedContent })
            yield chunk({}, 'tool_calls')
          })()
        })
      }
    }
  )
  const thinkingEnds: Array<{ index: number; text: string }> = []
  try {
    for await (const event of reply) {
      if (event.type === 'thinking_end') thinkingEnds.push({ index: event.contentIndex, text: event.content })
      if (event.type === 'text_start') {
        expect(thinkingEnds).toEqual([{ index: 0, text: 'First thought continues.' }])
        firstAnswer.resolve()
      }
      if (event.type === 'toolcall_start') {
        expect(thinkingEnds).toEqual([
          { index: 0, text: 'First thought continues.' },
          { index: 2, text: 'Second thought.' }
        ])
        finish.resolve()
      }
    }
  } finally {
    firstAnswer.resolve()
    finish.resolve()
  }

  expect(thinkingEnds).toHaveLength(2)
  expect(await reply.result()).toMatchObject({
    stopReason: 'toolUse',
    content: [
      { type: 'thinking', thinking: 'First thought continues.', thinkingSignature: signature },
      { type: 'text', text: 'First answer.' },
      { type: 'thinking', thinking: 'Second thought.', thinkingSignature: 'reasoning_content' },
      { type: 'toolCall', id: 'call_1', name: 'echo', arguments: {} }
    ]
  })
})
