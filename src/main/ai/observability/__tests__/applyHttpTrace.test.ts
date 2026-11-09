import type { FetchFunction } from '@ai-sdk/provider-utils'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { withoutDiagnostics } from '@main/core/logger/diagnosticScope'

import { applyHttpTrace, createHttpTraceFetch } from '../httpTraceFetch'

afterEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
  vi.unstubAllGlobals()
})

describe('applyHttpTrace', () => {
  it('bypasses body capture even when the fetch was wrapped before the temporary request', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.developer_mode.enabled', true)
    const exporter = new InMemorySpanExporter()
    const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
    const sent: unknown[] = []
    const fetch: FetchFunction = async (_input, init) => {
      sent.push(init?.body)
      return new Response('response')
    }
    const opts = { tracer: provider.getTracer('test') }
    const wrapped = createHttpTraceFetch(fetch, opts)
    try {
      await withoutDiagnostics(async () => {
        const settings = { fetch }
        applyHttpTrace(settings, opts)
        expect(settings.fetch).toBe(fetch)
        expect(await (await wrapped('https://provider.test', { body: 'private prompt' })).text()).toBe('response')
      })
      expect(sent).toEqual(['private prompt'])
      expect(exporter.getFinishedSpans()).toEqual([])
      await wrapped('https://provider.test', { body: 'ordinary prompt' })
      await new Promise((resolve) => setImmediate(resolve))
      expect(exporter.getFinishedSpans()).toHaveLength(1)
    } finally {
      await provider.shutdown()
    }
  })

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
