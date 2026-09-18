import type { FetchFunction } from '@ai-sdk/provider-utils'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyHttpTrace } from '../httpTraceFetch'

afterEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
  vi.unstubAllGlobals()
})

describe('applyHttpTrace', () => {
  it.each([false, true])(
    'records the chat topic with developer mode enabled, using global fetch when needed: %s',
    async (custom) => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.developer_mode.enabled', true)
      const exporter = new InMemorySpanExporter()
      const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
      const fetch: FetchFunction = async () => new Response(null, { status: 204 })
      vi.stubGlobal('fetch', fetch)
      const settings: { fetch?: FetchFunction } = custom ? { fetch } : {}
      try {
        applyHttpTrace(settings, { topicId: 'topic-1', modelName: 'model-1', tracer: provider.getTracer('test') })
        expect((await settings.fetch!('https://provider.test/chat')).status).toBe(204)
        const spans = exporter.getFinishedSpans()
        expect(spans).toHaveLength(1)
        expect(spans[0].attributes['trace.topicId']).toBe('topic-1')
        expect(spans[0].attributes['trace.modelName']).toBe('model-1')
      } finally {
        await provider.shutdown()
      }
    }
  )
})
