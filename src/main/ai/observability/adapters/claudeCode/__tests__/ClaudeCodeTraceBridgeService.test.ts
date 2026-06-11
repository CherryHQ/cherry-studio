import type * as NodeZlib from 'node:zlib'
import { gzipSync } from 'node:zlib'

import { BaseService } from '@main/core/lifecycle'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  traceStorageSetTopicId: vi.fn(),
  traceStorageSaveEntity: vi.fn(),
  traceStorageAddSpanEvent: vi.fn(),
  gunzipSync: vi.fn()
}))

// Spy on gunzipSync (passthrough to the real impl) so the gzip-bomb test can assert the
// bounded-inflation option is actually passed — otherwise the test passes even pre-fix.
vi.mock('node:zlib', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeZlib>()
  mocks.gunzipSync.mockImplementation(actual.gunzipSync)
  return { ...actual, gunzipSync: mocks.gunzipSync }
})

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    TraceStorageService: {
      setTopicId: mocks.traceStorageSetTopicId,
      saveEntity: mocks.traceStorageSaveEntity,
      addSpanEvent: mocks.traceStorageAddSpanEvent
    }
  } as any)
})

const { ClaudeCodeTraceBridgeService } = await import('../ClaudeCodeTraceBridgeService')

const traceContext = {
  topicId: 'agent-session:session-1',
  traceId: 'a'.repeat(32),
  modelName: 'claude-sonnet',
  sessionId: 'session-1',
  turnId: 'turn-1',
  rootSpanId: '1'.repeat(16)
}

describe('ClaudeCodeTraceBridgeService', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setPreferenceValue('app.developer_mode.enabled', true)
    vi.clearAllMocks()
  })

  it('activates without binding a collector port', async () => {
    const service = new ClaudeCodeTraceBridgeService()

    await service._doInit()

    expect(service.isTraceModeEnabled()).toBe(true)
    expect((service as any).server).toBeUndefined()
  })

  it('lazily starts the collector and returns Claude Code telemetry env', async () => {
    const service = new ClaudeCodeTraceBridgeService()
    await service._doInit()

    const env = await service.prepareTrace(traceContext)

    expect(env).toMatchObject({
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '1',
      ENABLE_BETA_TRACING_DETAILED: '1',
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_LOGS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'http/json',
      OTEL_TRACES_EXPORT_INTERVAL: '1000',
      OTEL_LOG_USER_PROMPTS: '1',
      OTEL_LOG_TOOL_DETAILS: '1',
      OTEL_LOG_TOOL_CONTENT: '1',
      OTEL_LOG_RAW_API_BODIES: '1',
      TRACEPARENT: `00-${traceContext.traceId}-${traceContext.rootSpanId}-01`
    })
    expect(env?.BETA_TRACING_ENDPOINT).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(env?.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).toBe(`${env?.BETA_TRACING_ENDPOINT}/v1/traces`)
    expect(env?.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT).toBe(`${env?.BETA_TRACING_ENDPOINT}/v1/logs`)
    expect(mocks.traceStorageSetTopicId).toHaveBeenCalledWith(traceContext.traceId, traceContext.topicId)

    await service._doStop()
  })

  it('ingests trace and log payloads through the local OTLP endpoints', async () => {
    const service = new ClaudeCodeTraceBridgeService()
    await service._doInit()
    const env = await service.prepareTrace(traceContext)

    await fetch(`${env?.BETA_TRACING_ENDPOINT}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: traceContext.traceId,
                    spanId: '2'.repeat(16),
                    name: 'claude_code.interaction',
                    startTimeUnixNano: '1700000000000000000',
                    endTimeUnixNano: '1700000001000000000'
                  }
                ]
              }
            ]
          }
        ]
      })
    })
    await fetch(`${env?.BETA_TRACING_ENDPOINT}/v1/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    traceId: traceContext.traceId,
                    spanId: '2'.repeat(16),
                    timeUnixNano: '1700000001500000000',
                    body: { stringValue: 'log body' }
                  }
                ]
              }
            ]
          }
        ]
      })
    })

    expect(mocks.traceStorageSaveEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '2'.repeat(16),
        parentId: traceContext.rootSpanId,
        topicId: traceContext.topicId
      })
    )
    expect(mocks.traceStorageAddSpanEvent).toHaveBeenCalledWith(
      traceContext.traceId,
      '2'.repeat(16),
      expect.objectContaining({ name: 'claude_code.log' })
    )

    await service._doStop()
  })

  it('requires JSON content type for OTLP endpoints', async () => {
    const service = new ClaudeCodeTraceBridgeService()
    await service._doInit()
    const env = await service.prepareTrace(traceContext)

    const response = await fetch(`${env?.BETA_TRACING_ENDPOINT}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf' },
      body: Buffer.from('not json')
    })

    expect(response.status).toBe(415)
    expect(mocks.traceStorageSaveEntity).not.toHaveBeenCalled()

    await service._doStop()
  })

  it('matches OTLP endpoint pathname and accepts gzip JSON payloads', async () => {
    const service = new ClaudeCodeTraceBridgeService()
    await service._doInit()
    const env = await service.prepareTrace(traceContext)

    const response = await fetch(`${env?.BETA_TRACING_ENDPOINT}/v1/traces?ignored=1`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip'
      },
      body: gzipSync(
        JSON.stringify({
          resourceSpans: [
            {
              scopeSpans: [
                {
                  spans: [
                    {
                      traceId: traceContext.traceId,
                      spanId: '6'.repeat(16),
                      name: 'claude_code.interaction',
                      startTimeUnixNano: '1700000000000000000',
                      endTimeUnixNano: '1700000001000000000'
                    }
                  ]
                }
              ]
            }
          ]
        })
      )
    })

    expect(response.status).toBe(200)
    expect(mocks.traceStorageSaveEntity).toHaveBeenCalledWith(expect.objectContaining({ id: '6'.repeat(16) }))

    await service._doStop()
  })

  it('rejects a gzip payload that decompresses beyond the size cap (gzip bomb)', async () => {
    const service = new ClaudeCodeTraceBridgeService()
    await service._doInit()
    const env = await service.prepareTrace(traceContext)

    // ~11 MiB of repeating bytes gzips to a few KB (well under the 10 MiB input cap), but
    // decompresses past the 10 MiB output cap — must be rejected without inflating it fully.
    const response = await fetch(`${env?.BETA_TRACING_ENDPOINT}/v1/traces`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip'
      },
      body: gzipSync(JSON.stringify({ pad: 'A'.repeat(11 * 1024 * 1024) }))
    })

    expect(response.status).toBe(400)
    expect(mocks.traceStorageSaveEntity).not.toHaveBeenCalled()
    // Asserts the security property (bounded inflation), not just that an oversize body 400s —
    // fails if `maxOutputLength` is dropped (the pre-fix full-decompress-then-check also 400'd).
    expect(mocks.gunzipSync).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ maxOutputLength: 10 * 1024 * 1024 })
    )

    await service._doStop()
  })

  it('skips trace preparation when traceparent ids are invalid', async () => {
    const service = new ClaudeCodeTraceBridgeService()
    await service._doInit()

    await expect(
      service.prepareTrace({
        ...traceContext,
        traceId: '0'.repeat(32)
      })
    ).resolves.toBeUndefined()
    expect(mocks.traceStorageSetTopicId).not.toHaveBeenCalled()
    expect((service as any).server).toBeUndefined()
  })

  it('does not prepare trace env when developer mode is disabled', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.developer_mode.enabled', false)
    const service = new ClaudeCodeTraceBridgeService()
    await service._doInit()

    await expect(service.prepareTrace(traceContext)).resolves.toBeUndefined()
    expect((service as any).server).toBeUndefined()
  })
})
