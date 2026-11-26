import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamListener } from '@main/ai/streamManager/types'
import { serializeError } from '@main/ai/utils/serializeError'
import { createUniqueModelId, ENDPOINT_TYPE } from '@shared/data/types/model'

const { mockStreamPrompt, mockAbort, mockGetProvider, mockListModels, captured } = vi.hoisted(() => ({
  mockStreamPrompt: vi.fn(),
  mockAbort: vi.fn(),
  mockGetProvider: vi.fn(),
  mockListModels: vi.fn(),
  captured: { listener: undefined as StreamListener | undefined }
}))

vi.mock('@main/utils/appEdition', () => ({ getAppEdition: () => 'global' }))

vi.mock('@data/services/ProviderService', () => ({
  providerService: { getByProviderId: mockGetProvider }
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: { list: mockListModels }
}))

import { createGatewayObjectTransports } from '../objectStream'

const agentContext = {
  agentSessionId: 'session-1',
  reasoningEffort: 'default' as const,
  fastMode: false,
  resolveUsage: () => undefined
}

const waitStartup = async <T>(pending: Promise<T>): Promise<T> =>
  Promise.race([
    pending,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Object startup content timed out')), 500))
  ])

async function collectEvents<T>(events: AsyncIterable<T>, onEvent?: (out: T[]) => void): Promise<T[]> {
  const out: T[] = []
  for await (const event of events) {
    out.push(event)
    onEvent?.(out)
  }
  return out
}

function observeEvents<T>(events: AsyncIterable<T>, ...expected: string[]) {
  const received = Promise.withResolvers<string>()
  const all = collectEvents(events, (out) => {
    const body = JSON.stringify(out)
    if (expected.every((value) => body.includes(value))) received.resolve(body)
  })
  return { received: waitStartup(received.promise), all }
}

beforeEach(() => {
  vi.clearAllMocks()
  captured.listener = undefined
  mockGetProvider.mockReturnValue({ id: 'openai', name: 'OpenAI', isEnabled: true })
  mockListModels.mockReturnValue([
    {
      id: createUniqueModelId('openai', 'gpt-4'),
      providerId: 'openai',
      apiModelId: 'gpt-4',
      capabilities: [],
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    }
  ])
  mockStreamPrompt.mockImplementation((opts: { listener: StreamListener }) => {
    captured.listener = opts.listener
  })
  MockApplicationUtils.setService('AiStreamManager', { streamPrompt: mockStreamPrompt, abort: mockAbort })
})

afterEach(() => MockApplicationUtils.resetServices())

describe('createGatewayObjectTransports (tool-input-error & file startup commitment)', () => {
  it.each(['anthropic-messages', 'openai-completions', 'openai-responses', 'google-generative-ai'] as const)(
    '%s resolves startup immediately on valid object tool-input-error without waiting for finish/onDone',
    async (transportKind) => {
      const transports = createGatewayObjectTransports({ agentContext })
      const pending =
        transportKind === 'anthropic-messages'
          ? transports['anthropic-messages'](
              { model: 'openai:gpt-4', max_tokens: 1024, messages: [], stream: true },
              {}
            )
          : transportKind === 'openai-completions'
            ? transports['openai-completions']({ model: 'openai:gpt-4', messages: [], stream: true }, {})
            : transportKind === 'openai-responses'
              ? transports['openai-responses']({ model: 'openai:gpt-4', input: [], stream: true }, {})
              : transports['google-generative-ai']({ model: 'openai:gpt-4', contents: [] }, {})

      await vi.waitFor(() => expect(captured.listener).toBeDefined())
      const listener = captured.listener!

      listener.onChunk({
        type: 'tool-input-error',
        toolCallId: 'err-call',
        toolName: 'unknown_tool',
        input: { path: { nested: true } },
        errorText: 'Schema mismatch'
      })

      const response = await waitStartup(pending as Promise<{ status: number; events: AsyncIterable<unknown> }>)
      expect(response.status).toBe(200)

      const args = '{"path":{"nested":true}}'
      const expectedName = '"name":"unknown_tool"'
      const expectedArgs =
        transportKind === 'google-generative-ai'
          ? `"args":${args}`
          : `"${transportKind === 'anthropic-messages' ? 'partial_json' : 'arguments'}":${JSON.stringify(args)}`
      const observed = observeEvents(response.events, expectedName, expectedArgs)
      const beforeDone = await observed.received
      expect(beforeDone).toContain(expectedName)
      expect(beforeDone).toContain(expectedArgs)
      if (transportKind === 'anthropic-messages') {
        expect(beforeDone.indexOf('"type":"message_start"')).toBeGreaterThanOrEqual(0)
        expect(beforeDone.indexOf('"type":"message_start"')).toBeLessThan(beforeDone.indexOf(expectedName))
      } else if (transportKind === 'openai-completions') {
        expect(beforeDone.indexOf('"role":"assistant"')).toBeGreaterThanOrEqual(0)
        expect(beforeDone.indexOf('"role":"assistant"')).toBeLessThan(beforeDone.indexOf(expectedName))
      } else if (transportKind === 'openai-responses') {
        expect(beforeDone.indexOf('"type":"response.created"')).toBeGreaterThanOrEqual(0)
        expect(beforeDone.indexOf('"type":"response.in_progress"')).toBeGreaterThan(
          beforeDone.indexOf('"type":"response.created"')
        )
        expect(beforeDone.indexOf('"type":"response.in_progress"')).toBeLessThan(beforeDone.indexOf(expectedName))
      }

      await listener.onDone({} as any)
      const events = await observed.all
      expect(JSON.stringify(events)).toContain('unknown_tool')
    }
  )

  it('google-generative-ai resolves startup immediately on valid base64 data-URL file without waiting for finish/onDone', async () => {
    const transports = createGatewayObjectTransports({ agentContext })
    const pending = transports['google-generative-ai']({ model: 'openai:gpt-4', contents: [] }, {})

    await vi.waitFor(() => expect(captured.listener).toBeDefined())
    const listener = captured.listener!

    listener.onChunk({
      type: 'file',
      mediaType: 'image/png',
      url: 'data:image/png;base64,AAAA'
    })

    const response = await waitStartup(pending)
    expect(response.status).toBe(200)

    const inlineData = '"inlineData":{"mimeType":"image/png","data":"AAAA"}'
    const observed = observeEvents(response.events, inlineData)
    expect(await observed.received).toContain(inlineData)

    await listener.onDone({} as any)
    const events = await observed.all
    expect(JSON.stringify(events)).toContain('"inlineData":{"mimeType":"image/png","data":"AAAA"}')
  })

  it.each(['anthropic-messages', 'openai-completions', 'openai-responses'] as const)(
    '%s preserves an object startup rejection after an ignored file chunk',
    async (transportKind) => {
      const transports = createGatewayObjectTransports({ agentContext })
      const pending =
        transportKind === 'anthropic-messages'
          ? transports['anthropic-messages'](
              { model: 'openai:gpt-4', max_tokens: 1024, messages: [], stream: true },
              {}
            )
          : transportKind === 'openai-completions'
            ? transports['openai-completions']({ model: 'openai:gpt-4', messages: [], stream: true }, {})
            : transports['openai-responses']({ model: 'openai:gpt-4', input: [], stream: true }, {})
      const error = new Error('Upstream failed')
      const rejected = expect(pending).rejects.toThrow(error.message)
      await vi.waitFor(() => expect(captured.listener).toBeDefined())
      const listener = captured.listener!

      listener.onChunk({ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' })
      await listener.onError({ status: 'error', error: serializeError(error) }, error)

      await rejected
    }
  )

  it.each([
    { transportKind: 'anthropic-messages', openingMarker: '"type":"message_start"' },
    { transportKind: 'openai-completions', openingMarker: '"role":"assistant"' },
    { transportKind: 'openai-responses', openingMarker: '"type":"response.created"' }
  ] as const)(
    '$transportKind emits ordered single opening scaffolding when an ignored file chunk precedes text-delta or onDone',
    async ({ transportKind, openingMarker }) => {
      const openTransport = (transports: ReturnType<typeof createGatewayObjectTransports>) =>
        transportKind === 'anthropic-messages'
          ? transports['anthropic-messages'](
              { model: 'openai:gpt-4', max_tokens: 1024, messages: [], stream: true },
              {}
            )
          : transportKind === 'openai-completions'
            ? transports['openai-completions']({ model: 'openai:gpt-4', messages: [], stream: true }, {})
            : transports['openai-responses']({ model: 'openai:gpt-4', input: [], stream: true }, {})

      const transportsWithText = createGatewayObjectTransports({ agentContext })
      const pendingWithText = openTransport(transportsWithText)
      await vi.waitFor(() => expect(captured.listener).toBeDefined())
      const listenerWithText = captured.listener!
      let settledWithText = false
      void pendingWithText.then(() => {
        settledWithText = true
      })

      listenerWithText.onChunk({ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' })
      await Promise.resolve()
      expect(settledWithText).toBe(false)

      listenerWithText.onChunk({ type: 'text-delta', id: 't1', delta: 'after ignored file' })
      const responseWithText = await waitStartup(
        pendingWithText as Promise<{ status: number; events: AsyncIterable<unknown> }>
      )
      await listenerWithText.onDone({} as any)
      const eventsWithText = JSON.stringify(await collectEvents(responseWithText.events))
      expect(eventsWithText.split(openingMarker).length - 1).toBe(1)
      expect(eventsWithText.indexOf(openingMarker)).toBeLessThan(eventsWithText.indexOf('after ignored file'))

      captured.listener = undefined
      const transportsDone = createGatewayObjectTransports({ agentContext })
      const pendingDone = openTransport(transportsDone)
      await vi.waitFor(() => expect(captured.listener).toBeDefined())
      const listenerDone = captured.listener!
      listenerDone.onChunk({ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' })
      await listenerDone.onDone({} as any)
      const responseDone = await waitStartup(pendingDone as Promise<{ status: number; events: AsyncIterable<unknown> }>)
      const eventsDone = JSON.stringify(await collectEvents(responseDone.events))
      expect(eventsDone.split(openingMarker).length - 1).toBe(1)
    }
  )

  it.each([null, [], 'invalid-json', undefined])(
    'rejects malformed tool-input-error before startup when input is %j',
    async (badInput) => {
      const transports = createGatewayObjectTransports({ agentContext })
      const pending = transports['openai-completions']({ model: 'openai:gpt-4', messages: [], stream: true }, {})
      const settled = pending.then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      )

      await vi.waitFor(() => expect(captured.listener).toBeDefined())
      captured.listener!.onChunk({
        type: 'tool-input-error',
        toolCallId: 'bad-call',
        toolName: 'read_file',
        input: badInput,
        errorText: 'Invalid tool arguments'
      })

      const result = await settled
      expect('error' in result).toBe(true)
      expect((result as { error: Error }).error).toMatchObject({ message: 'Invalid tool arguments' })
      expect(captured.listener!.isAlive?.()).toBe(false)
    }
  )

  it('rejects non-base64 Gemini file chunk before startup', async () => {
    const transports = createGatewayObjectTransports({ agentContext })
    const pending = transports['google-generative-ai']({ model: 'openai:gpt-4', contents: [] }, {})
    const settled = pending.then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    )

    await vi.waitFor(() => expect(captured.listener).toBeDefined())
    captured.listener!.onChunk({
      type: 'file',
      mediaType: 'image/png',
      url: 'https://example.com/image.png'
    })

    const result = await settled
    expect('error' in result).toBe(true)
    expect((result as { error: Error }).error).toMatchObject({
      message: 'Generated Gemini file must contain base64 data'
    })
    expect(captured.listener!.isAlive?.()).toBe(false)
  })

  it('fails the event stream when malformed tool-input-error or non-base64 file arrives after startup', async () => {
    for (const badChunk of [
      {
        type: 'tool-input-error' as const,
        toolCallId: 'bad-call',
        toolName: 'read_file',
        input: null,
        errorText: 'Invalid tool arguments'
      },
      {
        type: 'file' as const,
        mediaType: 'image/png',
        url: 'https://example.com/image.png'
      }
    ]) {
      captured.listener = undefined
      const transports = createGatewayObjectTransports({ agentContext })
      const pending = transports['google-generative-ai']({ model: 'openai:gpt-4', contents: [] }, {})
      await vi.waitFor(() => expect(captured.listener).toBeDefined())
      const listener = captured.listener!

      listener.onChunk({ type: 'text-delta', id: 't1', delta: 'hello' })
      const response = await pending
      listener.onChunk(badChunk)

      await expect(collectEvents(response.events)).rejects.toThrow()
      expect(listener.isAlive?.()).toBe(false)
    }
  })
})
