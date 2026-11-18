import { trace } from '@opentelemetry/api'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { streamText } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test'
import { expect, it, vi } from 'vitest'

import { buildTelemetry } from '../buildTelemetry'
import type { RequestScope } from '../scope'

it('keeps large model inputs intact while recording only SDK execution metadata', async () => {
  MockMainPreferenceServiceUtils.setPreferenceValue('app.developer_mode.enabled', true)
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
  const spy = vi.spyOn(trace, 'getTracer').mockReturnValue(provider.getTracer('test'))
  const prompt = 'image-history-data'.repeat(100_000)
  try {
    const telemetry = buildTelemetry({
      requestContext: { topicId: 'test', requestId: 'request' },
      model: { id: 'model' },
      sdkConfig: { providerId: 'test', modelId: 'model' }
    } as unknown as RequestScope)
    const result = streamText({
      prompt,
      experimental_telemetry: telemetry,
      model: new MockLanguageModelV3({
        doStream: async (options) => {
          expect(options.prompt).toEqual([{ role: 'user', content: [{ type: 'text', text: prompt }] }])
          return {
            stream: convertArrayToReadableStream([
              { type: 'text-start', id: 'answer' },
              { type: 'text-delta', id: 'answer', delta: 'done' },
              { type: 'text-end', id: 'answer' },
              {
                type: 'finish',
                finishReason: { unified: 'stop', raw: 'stop' },
                usage: {
                  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
                  outputTokens: { total: 1, text: 1, reasoning: undefined }
                }
              }
            ])
          }
        }
      })
    })
    expect(await result.text).toBe('done')
    await provider.forceFlush()
    const spans = exporter.getFinishedSpans()
    expect(spans.length).toBeGreaterThan(0)
    expect(spans.some((span) => span.attributes['ai.usage.inputTokens'] === 10)).toBe(true)
    for (const span of spans) {
      expect(span.attributes).not.toHaveProperty('ai.prompt')
      expect(span.attributes).not.toHaveProperty('ai.prompt.messages')
      expect(span.attributes).not.toHaveProperty('ai.response.text')
      expect(JSON.stringify(span.attributes).length).toBeLessThan(10_000)
    }
  } finally {
    spy.mockRestore()
    MockMainPreferenceServiceUtils.resetMocks()
    await provider.shutdown()
  }
})
