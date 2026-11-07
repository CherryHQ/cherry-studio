import { MockApplicationUtils } from '@test-mocks/main/application'
import type { UIMessageChunk } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type { AiService } from '@main/ai/AiService'
import { AiStreamManager } from '@main/ai/streamManager'
import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '@main/ai/streamManager'
import { BaseService } from '@main/core/lifecycle'
import { createUniqueModelId } from '@shared/data/types/model'

import { processMessage } from '../proxyStream'

vi.mock('@main/utils/appEdition', () => ({ getAppEdition: () => 'global' }))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    getByProviderId: () => ({ id: 'openai', name: 'OpenAI', isEnabled: true })
  }
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: {
    list: () => [{ id: 'openai::gpt-4', providerId: 'openai', apiModelId: 'gpt-4', capabilities: [] }]
  }
}))

vi.mock('@main/data/services/MessageService', () => ({ messageService: { getById: vi.fn() } }))

function controlledSource() {
  let controller!: ReadableStreamDefaultController<UIMessageChunk>
  const stream = new ReadableStream<UIMessageChunk>({
    start: (value) => {
      controller = value
    }
  })
  return { stream, enqueue: (chunk: UIMessageChunk) => controller.enqueue(chunk) }
}

async function createFixture() {
  const manager = new AiStreamManager()
  const gated = controlledSource()
  const gateway = controlledSource()
  const abortController = new AbortController()
  const chunks: UIMessageChunk[] = []
  const doneResults: StreamDoneResult[] = []
  const errorResults: StreamErrorResult[] = []
  const pausedResults: StreamPausedResult[] = []
  const listener: StreamListener = {
    id: 'startup-boundary',
    onChunk: (chunk) => {
      chunks.push(chunk)
    },
    onDone: (result) => {
      doneResults.push(result)
    },
    onError: (result) => {
      errorResults.push(result)
    },
    onPaused: (result) => {
      pausedResults.push(result)
    },
    isAlive: () => true
  }
  const streamText = vi.fn<AiService['streamText']>(async (request) => ({
    kind: 'chunks',
    stream: request.runtime?.kind === 'agent-session' ? gated.stream : gateway.stream
  }))
  MockApplicationUtils.setService('AiStreamManager', manager)
  MockApplicationUtils.setService('AiService', { streamText })
  MockApplicationUtils.setService('ApiGatewayService', {
    isInternalRequest: () => true,
    getAgentSessionId: (headers: Headers) => headers.get('x-cherry-agent-session-id') ?? undefined,
    resolveAgentSessionUsage: () => ({ agentSessionId: 'session-1' })
  })

  manager.send({
    topicId: 'agent-session:session-1',
    models: [
      {
        modelId: createUniqueModelId('openai', 'gpt-4'),
        abortController,
        request: {
          conversation: { id: 'session-1', topicId: 'agent-session:session-1' },
          trigger: 'submit-message',
          messages: [],
          runtime: { kind: 'agent-session', sessionId: 'session-1', turnId: 'turn-1' }
        }
      }
    ],
    listeners: [listener]
  })
  let committed = false
  const gatewayAbort = new AbortController()
  const response = processMessage({
    params: { model: 'openai:gpt-4', stream: true, messages: [] },
    inputFormat: 'openai',
    outputFormat: 'openai',
    requestHeaders: new Headers({ 'x-cherry-agent-session-id': 'session-1' }),
    signal: gatewayAbort.signal
  }).then(
    () => {
      committed = true
    },
    () => {
      committed = true
    }
  )
  await vi.advanceTimersByTimeAsync(0)
  expect(application.get('AiStreamManager')).toBe(manager)
  expect(streamText).toHaveBeenCalledTimes(2)
  expect(streamText.mock.calls[0][0].requestOptions?.signal).toBe(abortController.signal)

  return {
    gateway,
    abortController,
    chunks,
    doneResults,
    errorResults,
    pausedResults,
    isCommitted: () => committed,
    async dispose() {
      gatewayAbort.abort()
      await manager._doStop()
      await response
      await manager._doDestroy()
    }
  }
}

describe('processMessage → Agent startup deadline', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    MockApplicationUtils.resetServices()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  })

  afterEach(() => {
    vi.useRealTimers()
    MockApplicationUtils.resetServices()
  })

  it.each([true, false])(
    'protects a zero-chunk Agent execution only with gateway output (productive=%s)',
    async (productive) => {
      const fixture = await createFixture()
      try {
        if (productive) {
          fixture.gateway.enqueue({ type: 'tool-input-start', toolCallId: 'call', toolName: 'test' })
          for (let i = 0; i < 91; i++) {
            fixture.gateway.enqueue({ type: 'tool-input-delta', toolCallId: 'call', inputTextDelta: 'x' })
            await vi.advanceTimersByTimeAsync(1_000)
          }
          expect(fixture.errorResults).toHaveLength(0)
          expect(fixture.pausedResults).toHaveLength(0)
          expect(fixture.abortController.signal.aborted).toBe(false)
        } else {
          await vi.advanceTimersByTimeAsync(89_999)
          expect(fixture.errorResults).toHaveLength(0)
          expect(fixture.abortController.signal.aborted).toBe(false)
          await vi.advanceTimersByTimeAsync(1)
          expect(fixture.errorResults).toHaveLength(1)
          expect(fixture.errorResults[0].error).toMatchObject({ name: 'TimeoutError', i18nKey: 'request_timeout' })
          expect(fixture.pausedResults).toHaveLength(0)
          expect(fixture.abortController.signal.aborted).toBe(true)
          expect(fixture.abortController.signal.reason).toMatchObject({ name: 'TimeoutError' })
        }
        expect(fixture.chunks).toHaveLength(0)
        expect(fixture.doneResults).toHaveLength(0)
        expect(fixture.isCommitted()).toBe(false)
      } finally {
        await fixture.dispose()
      }
    }
  )
})
