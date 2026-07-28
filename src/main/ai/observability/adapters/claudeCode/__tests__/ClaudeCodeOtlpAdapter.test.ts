import { describe, expect, it } from 'vitest'

import { ClaudeCodeOtlpAdapter, type ClaudeCodeTraceContext } from '../ClaudeCodeOtlpAdapter'

const traceContext: ClaudeCodeTraceContext = {
  topicId: 'agent-session:session-1',
  traceId: 'a'.repeat(32),
  modelName: 'claude-sonnet',
  sessionId: 'session-1',
  turnId: 'turn-1',
  rootSpanId: '1'.repeat(16)
}

function spanPayload() {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'claude-code' } }]
        },
        scopeSpans: [
          {
            scope: {
              name: 'claude-code',
              attributes: [{ key: 'telemetry.sdk.language', value: { stringValue: 'nodejs' } }]
            },
            spans: [
              {
                traceId: traceContext.traceId,
                spanId: '2'.repeat(16),
                name: 'claude_code.interaction',
                kind: 'SPAN_KIND_INTERNAL',
                startTimeUnixNano: '1700000000000000000',
                endTimeUnixNano: '1700000001000000000',
                attributes: [
                  { key: 'span.type', value: { stringValue: 'claude_code.interaction' } },
                  { key: 'user_prompt', value: { stringValue: 'hello agent' } }
                ],
                status: { code: 'STATUS_CODE_UNSET' }
              },
              {
                traceId: traceContext.traceId,
                spanId: '3'.repeat(16),
                parentSpanId: '2'.repeat(16),
                name: 'claude_code.llm_request',
                kind: 1,
                startTimeUnixNano: '1700000001000000000',
                endTimeUnixNano: '1700000002000000000',
                attributes: [
                  { key: 'model', value: { stringValue: 'claude-sonnet-4-5' } },
                  { key: 'input_tokens', value: { intValue: '11' } },
                  { key: 'output_tokens', value: { intValue: '7' } },
                  { key: 'cache_read_tokens', value: { intValue: '3' } },
                  { key: 'response.model_output', value: { stringValue: 'assistant output' } }
                ],
                events: [
                  {
                    timeUnixNano: '1700000001500000000',
                    name: 'gen_ai.request.attempt',
                    attributes: [{ key: 'attempt', value: { intValue: 1 } }]
                  }
                ],
                links: [
                  {
                    traceId: '4'.repeat(32),
                    spanId: '5'.repeat(16),
                    attributes: [{ key: 'type', value: { stringValue: 'traceresponse' } }]
                  }
                ],
                status: { code: 'STATUS_CODE_OK' }
              }
            ]
          }
        ]
      }
    ]
  }
}

describe('ClaudeCodeOtlpAdapter', () => {
  it('converts Claude Code OTLP spans into SpanEntity records', () => {
    const spans = ClaudeCodeOtlpAdapter.spansFromPayload(spanPayload(), () => traceContext)

    expect(spans).toHaveLength(2)
    expect(spans[0]).toMatchObject({
      id: '2'.repeat(16),
      parentId: traceContext.rootSpanId,
      traceId: traceContext.traceId,
      name: 'claude_code.interaction',
      topicId: traceContext.topicId,
      modelName: traceContext.modelName,
      startTime: 1700000000000,
      endTime: 1700000001000,
      status: 'UNSET',
      kind: 'INTERNAL'
    })
    expect(spans[0].attributes).toMatchObject({
      'resource.service.name': 'claude-code',
      'scope.telemetry.sdk.language': 'nodejs',
      'trace.topicId': traceContext.topicId,
      'cs.agent_turn_id': traceContext.turnId,
      inputs: 'hello agent'
    })
    expect(spans[1]).toMatchObject({
      id: '3'.repeat(16),
      parentId: '2'.repeat(16),
      modelName: 'claude-sonnet-4-5',
      usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
        total_tokens: 18,
        prompt_tokens_details: { cache_read_tokens: 3 }
      },
      status: 'OK'
    })
    expect(spans[1].attributes).toMatchObject({
      outputs: 'assistant output'
    })
    expect(spans[1].events?.[0]).toMatchObject({
      name: 'gen_ai.request.attempt',
      attributes: { attempt: 1 }
    })
    expect(spans[1].links?.[0].context.spanId).toBe('5'.repeat(16))
  })

  it('converts matching OTLP logs into span events', () => {
    const events = ClaudeCodeOtlpAdapter.logEventsFromPayload({
      resourceLogs: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'claude-code' } }] },
          scopeLogs: [
            {
              logRecords: [
                {
                  traceId: traceContext.traceId,
                  spanId: '3'.repeat(16),
                  timeUnixNano: '1700000003000000000',
                  severityText: 'INFO',
                  body: { stringValue: 'tool result' },
                  attributes: [{ key: 'event.name', value: { stringValue: 'claude_code.tool_result' } }]
                }
              ]
            }
          ]
        }
      ]
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      traceId: traceContext.traceId,
      spanId: '3'.repeat(16),
      event: {
        name: 'claude_code.tool_result',
        attributes: {
          'resource.service.name': 'claude-code',
          'event.name': 'claude_code.tool_result',
          'log.body': 'tool result'
        }
      }
    })
  })

  it('does not make the trace root span its own parent', () => {
    const spans = ClaudeCodeOtlpAdapter.spansFromPayload(
      {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: traceContext.traceId,
                    spanId: traceContext.rootSpanId,
                    name: 'chat.turn',
                    startTimeUnixNano: '1700000000000000000',
                    endTimeUnixNano: '1700000001000000000'
                  }
                ]
              }
            ]
          }
        ]
      },
      () => traceContext
    )

    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({
      id: traceContext.rootSpanId,
      parentId: ''
    })
  })

  it('skips OTLP records with invalid trace or span ids', () => {
    const spans = ClaudeCodeOtlpAdapter.spansFromPayload(
      {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: '0'.repeat(32),
                    spanId: '2'.repeat(16),
                    name: 'invalid.trace'
                  },
                  {
                    traceId: traceContext.traceId,
                    spanId: '0'.repeat(16),
                    name: 'invalid.span'
                  }
                ]
              }
            ]
          }
        ]
      },
      () => traceContext
    )
    const events = ClaudeCodeOtlpAdapter.logEventsFromPayload({
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  traceId: traceContext.traceId,
                  spanId: '0'.repeat(16),
                  body: { stringValue: 'ignored' }
                }
              ]
            }
          ]
        }
      ]
    })

    expect(spans).toHaveLength(0)
    expect(events).toHaveLength(0)
  })
})
