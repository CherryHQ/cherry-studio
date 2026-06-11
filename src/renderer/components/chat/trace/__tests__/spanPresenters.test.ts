import { SPAN_NAME_TURN } from '@mcp-trace/trace-core'
import { describe, expect, it } from 'vitest'

import { buildSpanView } from '../spanPresenters'
import type { TraceNode } from '../traceNode'

const t = (key: string) => key

/** Minimal TraceNode: presenters only read attributes / modelName / events. */
function node(overrides: Partial<TraceNode>): TraceNode {
  return {
    id: 's1',
    traceId: 'tr',
    parentId: null,
    name: 'span',
    status: 'OK',
    startTime: 0,
    endTime: 1,
    attributes: {},
    events: [],
    children: [],
    percent: 100,
    start: 0,
    ...overrides
  } as unknown as TraceNode
}

const labels = (view: { rows: { label: string }[] }) => view.rows.map((r) => r.label)
const tabValues = (view: { tabs: { value: string }[] }) => view.tabs.map((t) => t.value)
const tabData = (view: { tabs: { value: string; data: unknown }[] }, value: string) =>
  view.tabs.find((tab) => tab.value === value)?.data

describe('buildSpanView span-type registry', () => {
  it('HTTP span: url/method/status rows, header tabs, body-only input, no model', () => {
    const view = buildSpanView(
      node({
        modelName: 'gpt-x', // inherited; must NOT produce a model row
        attributes: {
          tags: 'HTTP',
          'http.method': 'POST',
          'http.url': 'https://api.example.com/v1/chat',
          'http.status': 200,
          'http.statusText': 'OK',
          'http.request.headers': '{"authorization":"***"}',
          'http.response.headers': '{"content-type":"application/json"}',
          inputs: '{"model":"gpt-x"}',
          outputs: '{"choices":[]}'
        }
      }),
      t
    )

    expect(labels(view)).toEqual(['trace.requestMethod', 'trace.requestUrl', 'trace.responseStatus'])
    expect(labels(view)).not.toContain('trace.model')
    expect(tabValues(view)).toEqual(['inputs', 'outputs', 'requestHeaders', 'responseHeaders', 'raw'])
    expect(tabData(view, 'inputs')).toBe('{"model":"gpt-x"}')
    expect(tabData(view, 'requestHeaders')).toBe('{"authorization":"***"}')
  })

  it('MCP span: server identity in rows, tool args as input, no model/server-config leak', () => {
    const view = buildSpanView(
      node({
        modelName: 'gpt-x',
        attributes: {
          tags: 'MCP',
          inputs: JSON.stringify([
            {
              server: { name: 'firecrawl', type: 'stdio', description: 'FireCrawl MCP', env: { KEY: 'secret' } },
              name: 'firecrawl_search',
              args: { query: 'hi' }
            }
          ]),
          outputs: '{"ok":true}'
        }
      }),
      t
    )

    expect(view.rows).toEqual([
      { label: 'trace.serverName', value: 'firecrawl' },
      { label: 'trace.serverType', value: 'stdio' },
      { label: 'trace.serverDescription', value: 'FireCrawl MCP' }
    ])
    expect(labels(view)).not.toContain('trace.model')
    // Input is the tool arguments, NOT the full {server,name,args} wrapper (which carries env secrets).
    expect(tabData(view, 'inputs')).toEqual({ query: 'hi' })
    expect(tabValues(view)).toEqual(['inputs', 'outputs', 'raw'])
  })

  it('model-call span: a real model attribute yields a model row', () => {
    const view = buildSpanView(
      node({ modelName: 'gpt-4', attributes: { 'ai.model.id': 'gpt-4', 'ai.model.provider': 'openai' } }),
      t
    )
    expect(labels(view)).toContain('trace.model')
    expect(tabValues(view)).toEqual(['inputs', 'outputs', 'raw'])
  })

  it('ai.turn span: identity/shape rows + boundary input/output tabs', () => {
    const view = buildSpanView(
      node({
        name: SPAN_NAME_TURN,
        status: 'OK',
        modelName: 'gpt-4',
        attributes: {
          'cs.model_id': 'openai::gpt-4',
          'gen_ai.agent.name': 'Research Agent',
          'gen_ai.operation.name': 'invoke_agent',
          'cs.tool_calls': 3,
          inputs: 'what is the weather?',
          outputs: 'it is sunny'
        }
      }),
      t
    )

    expect(labels(view)).toEqual(['trace.model', 'trace.agent', 'trace.operation', 'trace.toolCalls', 'trace.status'])
    expect(view.rows.find((r) => r.label === 'trace.agent')?.value).toBe('Research Agent')
    expect(view.rows.find((r) => r.label === 'trace.toolCalls')?.value).toBe('3')
    expect(view.rows.find((r) => r.label === 'trace.status')?.value).toBe('OK')
    expect(tabValues(view)).toEqual(['inputs', 'outputs', 'raw'])
    expect(tabData(view, 'inputs')).toBe('what is the weather?')
    expect(tabData(view, 'outputs')).toBe('it is sunny')
  })

  it('generic span: inherited modelName alone does NOT show a model', () => {
    // A tool-execution span carries the inherited trace.modelName but no real model attribute.
    const view = buildSpanView(node({ modelName: 'gpt-x', attributes: { tool_name: 'read_file' } }), t)
    expect(view.rows).toEqual([])
    expect(labels(view)).not.toContain('trace.model')
    expect(tabValues(view)).toEqual(['inputs', 'outputs', 'raw'])
  })
})
