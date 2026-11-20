import { type Message, createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { streamSimple as anthropicStream } from '@earendil-works/pi-ai/api/anthropic-messages'
import { streamSimple as bedrockStream } from '@earendil-works/pi-ai/api/bedrock-converse-stream'
import { streamSimple as completionsStream } from '@earendil-works/pi-ai/api/openai-completions'
import { canSuggestPrompt, createQueryFork } from '@earendil-works/pi-ai/utils/query-fork'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { expect, it } from 'vitest'

import { assistantReply, MODEL } from './sessionSupport'
import { toolCallPart } from './subagentSupport'

const messages: Message[] = [
  {
    role: 'system',
    timestamp: 0,
    content: 'Parent instructions',
    toolsAdded: [{ name: 'echo', description: 'Echo', parameters: { type: 'object', properties: {} } }]
  },
  { role: 'user', content: 'Fix the bug', timestamp: 1 },
  assistantReply('Fixed the bug'),
  { role: 'user', content: 'Check the fix', timestamp: 2 },
  assistantReply('Checked the fix')
]

it.each(
  (['anthropic', 'openai', 'bedrock'] as const).flatMap((api) =>
    [0, 1, 3].flatMap((updates) =>
      (api === 'bedrock' ? [false] : [false, true]).map((midSystem) => ({ api, updates, midSystem }))
    )
  )
)(
  'preserves parent $api cache breakpoints with $updates system updates (mid-system: $midSystem) without caching the fork suffix',
  async ({ api, updates, midSystem }) => {
    const transcript: Message[] = [
      ...messages.slice(0, 3),
      ...Array.from(
        { length: updates },
        (_, index): Message => ({
          role: 'system',
          content: `Updated instruction ${index}`,
          timestamp: 2
        })
      ),
      ...messages.slice(3)
    ]
    const payloads: any[] = []
    const model: typeof MODEL = {
      ...MODEL,
      api: api === 'anthropic' ? 'anthropic-messages' : 'openai-completions',
      compat: { cacheControlFormat: 'anthropic' as const }
    }
    const stream: Parameters<typeof createQueryFork>[2] = (target, context, options) =>
      api === 'anthropic'
        ? anthropicStream(
            { ...target, api: 'anthropic-messages', compat: { supportsMidConvoSystemMessages: midSystem } },
            normalizeContext(context),
            options
          )
        : api === 'bedrock'
          ? bedrockStream(
              {
                ...target,
                id: 'anthropic.claude-sonnet-4-20250514-v1:0',
                api: 'bedrock-converse-stream',
                compat: undefined
              },
              normalizeContext(context),
              options
            )
          : completionsStream(
              {
                ...target,
                api: 'openai-completions',
                compat: { cacheControlFormat: 'anthropic', supportsMidConvoSystemMessages: midSystem }
              },
              normalizeContext(context),
              options
            )
    const options = {
      apiKey: 'fixture-key',
      sessionId: 'parent-session',
      reasoning: 'high' as const,
      onPayload: (payload: unknown) => {
        payloads.push(payload)
        throw new Error('Captured before network')
      }
    }
    await stream(model, { messages: transcript.slice(0, -1) }, options).result()
    const fork = createQueryFork(model, transcript, stream, options)
    await fork.query('Predict the next user prompt', new AbortController().signal)
    const [parent, prediction] = payloads
    expect(prediction.tools).toEqual(parent.tools)
    expect(prediction.toolConfig).toEqual(parent.toolConfig)
    expect(prediction.system).toEqual(parent.system)
    expect(prediction.messages.slice(0, parent.messages.length)).toEqual(parent.messages)
    const cacheKey = api === 'bedrock' ? 'cachePoint' : 'cache_control'
    expect(JSON.stringify(prediction.messages.slice(parent.messages.length))).not.toContain(cacheKey)
    expect(JSON.stringify(parent.messages)).toContain(cacheKey)
    expect(JSON.stringify(prediction.messages.at(-1))).toContain('Predict the next user prompt')
  }
)

it('aborts a tool as soon as its stream starts, without waiting for tool arguments or running it', async () => {
  let signal: AbortSignal | undefined
  const original = messages.map((message) => ({ ...message }))
  const fork = createQueryFork(MODEL, messages, (_model, _context, options) => {
    signal = options.signal
    const response = createAssistantMessageEventStream()
    response.push({
      type: 'toolcall_start',
      contentIndex: 0,
      partial: assistantReply([toolCallPart('call', 'echo', {})], 'toolUse')
    })
    return response
  })
  expect(await fork.query('predict', new AbortController().signal)).toEqual({ calledTool: true, message: undefined })
  expect(signal?.aborted).toBe(true)
  expect(messages).toEqual(original)
})

it('suppresses early conversations, failed replies and cold caches before requesting a prediction', () => {
  expect(canSuggestPrompt(messages.slice(0, 3))).toBe(false)
  expect(canSuggestPrompt(messages)).toBe(true)
  expect(canSuggestPrompt([...messages.slice(0, -1), assistantReply('failed', 'error')])).toBe(false)
  expect(canSuggestPrompt([...messages.slice(0, -1), assistantReply('large', 'stop', 10_001)])).toBe(false)
  const created = assistantReply('cache write')
  created.usage.cacheWrite = 10_001
  expect(canSuggestPrompt([...messages.slice(0, -1), created])).toBe(false)
})
