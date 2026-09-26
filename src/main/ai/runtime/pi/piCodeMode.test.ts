import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'

import {
  PI_TOOL_CALL_TOOL_NAME,
  PI_TOOL_DESCRIBE_TOOL_NAME,
  PI_TOOL_EXEC_TOOL_NAME,
  PI_TOOL_SEARCH_TOOL_NAME
} from '@shared/ai/piBuiltinTools'

import type { PiToolAuthorizer } from './approvalExtension'
import { createPiCodeModeTools } from './piCodeMode'
import type { PiMcpToolDefinition } from './piMcpToolAdapter'

function tool(overrides: Partial<ToolDefinition> & Pick<ToolDefinition, 'name'>): ToolDefinition {
  return {
    label: overrides.name,
    description: `${overrides.name} description`,
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query']
    },
    execute: vi.fn<ToolDefinition['execute']>(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
      details: { ok: true }
    })),
    ...overrides
  }
}

function browserTool(overrides: Partial<ToolDefinition> & Pick<ToolDefinition, 'name' | 'label'>): PiMcpToolDefinition {
  return {
    ...tool(overrides),
    source: { serverName: '@cherry/browser', toolName: overrides.label }
  }
}

function codeModeTools(
  catalog: PiMcpToolDefinition[],
  disabled = new Set<string>(),
  authorize: PiToolAuthorizer = async ({ toolName }) =>
    disabled.has(toolName) ? { block: true, reason: `Tool "${toolName}" is disabled for this agent.` } : undefined
) {
  return createPiCodeModeTools(catalog, (name) => disabled.has(name), authorize)
}

describe('createPiCodeModeTools', () => {
  it('searches names and descriptions and returns TypeScript declarations', async () => {
    const searchIssues = tool({ name: 'mcp__github__search_issues', description: 'Find repository issues' })
    const listFiles = tool({ name: 'mcp__files__list', description: 'List files' })
    const search = codeModeTools([searchIssues, listFiles]).find((item) => item.name === PI_TOOL_SEARCH_TOOL_NAME)!

    const result = await search.execute('search-1', { query: 'repository' }, undefined, undefined, {} as never)
    const text = result.content[0].type === 'text' ? result.content[0].text : ''

    expect(text).toContain('declare const tools')
    expect(text).toContain('mcp__github__search_issues')
    expect(text).not.toContain('mcp__files__list')
  })

  it('keeps disabled tools out of discovery', async () => {
    const name = 'mcp__github__search_issues'
    const search = codeModeTools([tool({ name })], new Set([name])).find(
      (item) => item.name === PI_TOOL_SEARCH_TOOL_NAME
    )!

    const result = await search.execute('search-1', {}, undefined, undefined, {} as never)
    const text = result.content[0].type === 'text' ? result.content[0].text : ''

    expect(text).toBe('No tools matched. Broaden the query or omit it.')
  })

  it('describes and calls a discovered tool through the shared authorization boundary', async () => {
    const name = 'mcp__github__search_issues'
    const execute = vi.fn<ToolDefinition['execute']>(async () => ({
      content: [{ type: 'text' as const, text: 'found' }],
      details: { total: 1 }
    }))
    const authorize = vi.fn<PiToolAuthorizer>(async () => undefined)
    const tools = codeModeTools(
      [
        {
          ...tool({ name, description: 'Find repository issues', execute }),
          outputSchema: { type: 'object', properties: { total: { type: 'integer' } }, required: ['total'] }
        }
      ],
      new Set(),
      authorize
    )
    const describe = tools.find((item) => item.name === PI_TOOL_DESCRIBE_TOOL_NAME)!
    const call = tools.find((item) => item.name === PI_TOOL_CALL_TOOL_NAME)!

    const description = await describe.execute('describe-1', { name }, undefined, undefined, {} as never)
    const callResult = await call.execute(
      'call-1',
      { name, params: { query: 'bug' } },
      undefined,
      undefined,
      {} as never
    )

    expect(description.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Find repository issues')
    })
    expect(description.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining(`invoke(name: "${name}"`)
    })
    expect(description.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Promise<{ total: number }>')
    })
    expect(callResult).toEqual({ content: [{ type: 'text', text: 'found' }], details: { total: 1 } })
    expect(description.details).toEqual(
      expect.objectContaining({ name, declaration: expect.stringContaining('invoke(') })
    )
    expect(description.details).not.toHaveProperty('parameters')
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: name, toolCallId: 'call-1', input: { query: 'bug' } })
    )
    expect(execute).toHaveBeenCalledWith('call-1::call', { query: 'bug' }, undefined, undefined, expect.anything())
  })

  it('uses the outer tool call identity for nested approvals and a distinct identity for execution', async () => {
    const execute = vi.fn<ToolDefinition['execute']>(async () => ({
      content: [{ type: 'text' as const, text: 'found' }],
      details: { total: 1 }
    }))
    const inner = tool({ name: 'mcp__github__search_issues', execute })
    const authorize = vi.fn<PiToolAuthorizer>(async () => undefined)
    const exec = codeModeTools([inner], new Set(), authorize).find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!
    const controller = new AbortController()

    const result = await exec.execute(
      'outer-1',
      { code: `return await tools.invoke('mcp__github__search_issues', { query: 'bug' })` },
      controller.signal,
      undefined,
      {} as never
    )

    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0][0]).toMatch(/^outer-1::exec::/)
    expect(execute.mock.calls[0][1]).toEqual({ query: 'bug' })
    expect(execute.mock.calls[0][2]).toBeInstanceOf(AbortSignal)
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'mcp__github__search_issues',
        toolCallId: 'outer-1',
        input: { query: 'bug' },
        signal: expect.any(AbortSignal)
      })
    )
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('found') })
  })

  it('generates a typed browser facade and dispatches its methods through the shared authorization boundary', async () => {
    const name = 'mcp__4b1884f6-78ad-4c2f-a523-8f0d7e784640__open'
    const execute = vi.fn<ToolDefinition['execute']>(async () => ({
      content: [{ type: 'text' as const, text: '{"title":"Example"}' }],
      details: { title: 'Example' }
    }))
    const browserOpen: PiMcpToolDefinition = {
      ...tool({
        name,
        description: 'Open a browser page',
        parameters: {
          type: 'object',
          properties: { url: { type: 'string' } },
          required: ['url']
        },
        execute
      }),
      source: { serverName: '@cherry/browser', toolName: 'open' },
      outputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }
    }
    const authorize = vi.fn<PiToolAuthorizer>(async () => undefined)
    const tools = codeModeTools([browserOpen], new Set(), authorize)
    const search = tools.find((item) => item.name === PI_TOOL_SEARCH_TOOL_NAME)!
    const exec = tools.find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!

    const discovery = await search.execute('search-1', { query: 'browser' }, undefined, undefined, {} as never)
    const result = await exec.execute(
      'outer-1',
      { code: "return await browser.open({ url: 'https://example.com' })" },
      undefined,
      undefined,
      {} as never
    )

    expect(discovery.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringMatching(
        /declare const browser[\s\S]*open\(params: \{ url: string \}\): Promise<\{ title: string \}>/
      )
    })
    expect(result.details).toEqual({ result: { title: 'Example' }, logs: undefined })
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: name,
        toolCallId: 'outer-1',
        input: { url: 'https://example.com' }
      })
    )
    expect(execute).toHaveBeenCalledWith(
      expect.stringMatching(/^outer-1::exec::/),
      { url: 'https://example.com' },
      expect.any(AbortSignal),
      undefined,
      expect.anything()
    )
  })

  it('omits ambiguous browser facade methods while keeping the original tools callable', async () => {
    const first = browserTool({ name: 'mcp__browser-a__open', label: 'open' })
    const second = browserTool({ name: 'mcp__browser-b__open', label: 'open' })
    const screenshot = browserTool({ name: 'mcp__browser-a__screenshot', label: 'screenshot' })
    const tools = codeModeTools([first, second, screenshot])
    const search = tools.find((item) => item.name === PI_TOOL_SEARCH_TOOL_NAME)!
    const call = tools.find((item) => item.name === PI_TOOL_CALL_TOOL_NAME)!

    const discovery = await search.execute('search-1', { query: 'browser' }, undefined, undefined, {} as never)
    const text = discovery.content[0].type === 'text' ? discovery.content[0].text : ''
    expect(text).toContain('mcp__browser-a__open')
    expect(text).toContain('mcp__browser-b__open')
    expect(text).not.toMatch(/\bopen\(params:/)
    expect(text).toMatch(/\bscreenshot\(params:/)

    for (const name of [first.name, second.name]) {
      const result = await call.execute('call-1', { name, params: {} }, undefined, undefined, {} as never)
      expect(result.details).toEqual({ ok: true })
    }
  })

  it('keeps an enabled browser alias when its colliding tool is disabled', async () => {
    const enabled = browserTool({ name: 'mcp__browser-a__open', label: 'open' })
    const disabled = browserTool({ name: 'mcp__browser-b__open', label: 'open' })
    const tools = codeModeTools([enabled, disabled], new Set([disabled.name]))
    const search = tools.find((item) => item.name === PI_TOOL_SEARCH_TOOL_NAME)!
    const exec = tools.find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!

    const discovery = await search.execute('search-1', { query: 'browser' }, undefined, undefined, {} as never)
    const text = discovery.content[0].type === 'text' ? discovery.content[0].text : ''
    expect(text).toContain(enabled.name)
    expect(text).not.toContain(disabled.name)
    expect(text).toMatch(/\bopen\(params:/)

    const result = await exec.execute(
      'outer-1',
      { code: 'return await browser.open({ query: "example" })' },
      undefined,
      undefined,
      {} as never
    )
    expect(result.details).toEqual({
      result: { content: [{ type: 'text', text: 'ok' }], details: { ok: true } },
      logs: undefined
    })
  })

  it('reveals a browser alias when a colliding tool is disabled after catalog creation', async () => {
    const enabled = browserTool({ name: 'mcp__browser-a__open', label: 'open' })
    const other = browserTool({ name: 'mcp__browser-b__open', label: 'open' })
    const disabled = new Set<string>()
    const tools = codeModeTools([enabled, other], disabled)
    const search = tools.find((item) => item.name === PI_TOOL_SEARCH_TOOL_NAME)!
    const exec = tools.find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!

    const before = await search.execute('search-1', { query: 'browser' }, undefined, undefined, {} as never)
    expect(before.content[0]).toMatchObject({ type: 'text', text: expect.not.stringMatching(/\bopen\(params:/) })

    disabled.add(other.name)
    const after = await search.execute('search-2', { query: 'browser' }, undefined, undefined, {} as never)
    expect(after.content[0]).toMatchObject({ type: 'text', text: expect.stringMatching(/\bopen\(params:/) })

    const result = await exec.execute(
      'outer-1',
      { code: 'return await browser.open({ query: "example" })' },
      undefined,
      undefined,
      {} as never
    )
    expect(result.details).toEqual({
      result: { content: [{ type: 'text', text: 'ok' }], details: { ok: true } },
      logs: undefined
    })
  })

  it('forwards images returned by browser facade methods as tool_exec image content', async () => {
    const screenshot = browserTool({
      name: 'mcp__4b1884f6-78ad-4c2f-a523-8f0d7e784640__screenshot',
      label: 'screenshot',
      execute: vi.fn(async () => ({
        content: [{ type: 'image' as const, data: 'base64-png', mimeType: 'image/png' }],
        details: undefined
      }))
    })
    const exec = codeModeTools([screenshot]).find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!

    const result = await exec.execute(
      'outer-1',
      { code: "await browser.screenshot({}); return 'captured'" },
      undefined,
      undefined,
      {} as never
    )

    expect(result.content).toEqual([
      { type: 'text', text: '"captured"' },
      { type: 'image', data: 'base64-png', mimeType: 'image/png' }
    ])
  })

  it('emits images once when code returns a raw MCP result', async () => {
    const screenshot = browserTool({
      name: 'mcp__4b1884f6-78ad-4c2f-a523-8f0d7e784640__screenshot',
      label: 'screenshot',
      execute: vi.fn(async () => ({
        content: [{ type: 'image' as const, data: 'base64-png', mimeType: 'image/png' }],
        details: undefined
      }))
    })
    const exec = codeModeTools([screenshot]).find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!

    const result = await exec.execute(
      'outer-1',
      { code: 'return await browser.screenshot({})' },
      undefined,
      undefined,
      {} as never
    )

    expect(result.content).toHaveLength(2)
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.not.stringContaining('base64-png') })
    expect(result.content[1]).toEqual({ type: 'image', data: 'base64-png', mimeType: 'image/png' })
    expect(result.details).toMatchObject({ result: { content: [] } })
  })

  it('keeps browser facade calls behind the nested approval gate', async () => {
    const reset = browserTool({ name: 'mcp__4b1884f6-78ad-4c2f-a523-8f0d7e784640__reset', label: 'reset' })
    const authorize = vi.fn<PiToolAuthorizer>(async () => ({ block: true, reason: 'User denied browser control.' }))
    const exec = codeModeTools([reset], new Set(), authorize).find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!

    await expect(
      exec.execute('outer-1', { code: 'return await browser.reset({})' }, undefined, undefined, {} as never)
    ).rejects.toThrow('User denied browser control.')
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'mcp__4b1884f6-78ad-4c2f-a523-8f0d7e784640__reset',
        toolCallId: 'outer-1',
        input: {}
      })
    )
    expect(reset.execute).not.toHaveBeenCalled()
  })

  it('guides browser tool_exec calls to batch actions and capture one final state', () => {
    const exec = codeModeTools([]).find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!

    expect(exec.promptGuidelines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/batch/i),
        expect.stringMatching(/one final (snapshot|screenshot)/i)
      ])
    )
  })

  it('decodes a structured MCP result for tool_exec without leaking the MCP content envelope', async () => {
    const name = 'mcp__browser__open'
    const inner = tool({
      name,
      execute: vi.fn(async () => ({
        content: [{ type: 'text' as const, text: '{"title":"Example"}' }],
        details: undefined
      }))
    })
    const exec = codeModeTools([
      { ...inner, outputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } }
    ]).find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!

    const result = await exec.execute(
      'outer-1',
      { code: `return await tools.invoke('${name}', {})` },
      undefined,
      undefined,
      {} as never
    )

    expect(result.content[0]).toEqual({ type: 'text', text: '{\n  "title": "Example"\n}' })
    expect(result.content[0]).not.toMatchObject({ text: expect.stringContaining('content') })
  })

  it('decodes schema-bearing MCP text when structuredContent is absent', async () => {
    const name = 'mcp__browser__open'
    const inner = tool({
      name,
      execute: vi.fn(async () => ({
        content: [{ type: 'text' as const, text: '{"title":"Example"}' }],
        details: null
      }))
    })
    const exec = codeModeTools([
      { ...inner, outputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } }
    ]).find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!

    const result = await exec.execute(
      'outer-1',
      { code: `return await tools.invoke('${name}', {})` },
      undefined,
      undefined,
      {} as never
    )

    expect(result.details).toEqual({ result: { title: 'Example' }, logs: undefined })
  })

  it('decodes the one text result when a structured MCP response also includes an attachment', async () => {
    const name = 'mcp__browser__open'
    const inner = tool({
      name,
      execute: vi.fn(async () => ({
        content: [
          { type: 'text' as const, text: '{"title":"Example"}' },
          { type: 'image' as const, data: 'abc', mimeType: 'image/png' }
        ],
        details: undefined
      }))
    })
    const exec = codeModeTools([
      { ...inner, outputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } }
    ]).find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!

    const result = await exec.execute(
      'outer-1',
      { code: `return await tools.invoke('${name}', {})` },
      undefined,
      undefined,
      {} as never
    )

    expect(result.details).toEqual({ result: { title: 'Example' }, logs: undefined })
  })

  it('joins multiple text blocks for a string output schema', async () => {
    const name = 'mcp__notes__read'
    const inner = tool({
      name,
      execute: vi.fn(async () => ({
        content: [
          { type: 'text' as const, text: 'First paragraph.' },
          { type: 'text' as const, text: 'Second paragraph.' }
        ],
        details: undefined
      }))
    })
    const exec = codeModeTools([{ ...inner, outputSchema: { type: 'string' } }]).find(
      (item) => item.name === PI_TOOL_EXEC_TOOL_NAME
    )!

    const result = await exec.execute(
      'outer-1',
      { code: `return await tools.invoke('${name}', {})` },
      undefined,
      undefined,
      {} as never
    )

    expect(result.details).toEqual({ result: 'First paragraph.\nSecond paragraph.', logs: undefined })
  })

  it('joins multiple text blocks before decoding a structured output schema', async () => {
    const name = 'mcp__browser__open'
    const inner = tool({
      name,
      execute: vi.fn(async () => ({
        content: [
          { type: 'text' as const, text: '{"title":' },
          { type: 'text' as const, text: '"Example"}' }
        ],
        details: undefined
      }))
    })
    const exec = codeModeTools([
      { ...inner, outputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } }
    ]).find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!

    const result = await exec.execute(
      'outer-1',
      { code: `return await tools.invoke('${name}', {})` },
      undefined,
      undefined,
      {} as never
    )

    expect(result.details).toEqual({ result: { title: 'Example' }, logs: undefined })
  })

  it('matches tool name segments when no description is available', async () => {
    const search = codeModeTools([tool({ name: 'mcp__github__searchIssues', description: '' })]).find(
      (item) => item.name === PI_TOOL_SEARCH_TOOL_NAME
    )!

    const result = await search.execute('search-1', { query: 'github issues' }, undefined, undefined, {} as never)
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('mcp__github__searchIssues')
    })
  })

  it('splits uppercase abbreviations in tool names', async () => {
    const search = codeModeTools([tool({ name: 'mcp__server__getHTTPResponse', description: '' })]).find(
      (item) => item.name === PI_TOOL_SEARCH_TOOL_NAME
    )!

    const result = await search.execute('search-1', { query: 'http response' }, undefined, undefined, {} as never)
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('mcp__server__getHTTPResponse')
    })
  })

  it('normalizes a BigInt code result before storing it in details', async () => {
    const exec = codeModeTools([]).find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!

    const result = await exec.execute('outer-1', { code: 'return 1n' }, undefined, undefined, {} as never)

    expect(result.details).toEqual({ result: '1', logs: undefined })
  })

  it('rejects a cyclic code result before Pi attempts to persist it', async () => {
    const exec = codeModeTools([]).find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!

    await expect(
      exec.execute(
        'outer-1',
        { code: 'const result = {}; result.self = result; return result' },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow('tool_exec result must be JSON-serializable')
  })

  it('explains a missing return and preserves logs', async () => {
    const exec = codeModeTools([]).find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!

    await expect(
      exec.execute('outer-1', { code: "console.log('checkpoint')" }, undefined, undefined, {} as never)
    ).rejects.toThrow(/returned no value; add an explicit return[\s\S]*Logs:[\s\S]*checkpoint/)
  })

  it('waits for an unobserved invocation to settle before completing', async () => {
    let resolveTool!: () => void
    const inner = tool({
      name: 'mcp__github__search_issues',
      execute: vi.fn<ToolDefinition['execute']>(
        () =>
          new Promise<Awaited<ReturnType<ToolDefinition['execute']>>>((resolve) => {
            resolveTool = () => resolve({ content: [{ type: 'text', text: 'done' }], details: undefined })
          })
      )
    })
    const exec = codeModeTools([inner]).find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!

    const result = exec.execute(
      'outer-1',
      { code: "tools.invoke('mcp__github__search_issues', {}); return 'queued'" },
      undefined,
      undefined,
      {} as never
    )
    await vi.waitFor(() => expect(inner.execute).toHaveBeenCalledOnce())
    let settled = false
    void result.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(false)
    resolveTool()

    await expect(result).resolves.toMatchObject({ details: { result: 'queued' } })
  })

  it('keeps a caught nested failure from failing the completed script', async () => {
    const failed = tool({
      name: 'mcp__first__flaky',
      execute: vi.fn<ToolDefinition['execute']>(async () => {
        throw new Error('temporary failure')
      })
    })
    const succeeded = tool({ name: 'mcp__second__stable' })
    const exec = codeModeTools([failed, succeeded]).find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!

    const result = await exec.execute(
      'outer-1',
      {
        code: `let recovered = false; try { await tools.invoke('mcp__first__flaky', {}) } catch { recovered = true }; await tools.invoke('mcp__second__stable', {}); return { recovered }`
      },
      undefined,
      undefined,
      {} as never
    )

    expect(result.details).toEqual({ result: { recovered: true }, logs: undefined })
    expect(succeeded.execute).toHaveBeenCalledOnce()
  })

  it('drains a follow-up invocation started from a settled callback', async () => {
    const first = tool({ name: 'mcp__first__lookup' })
    let resolveSecond!: () => void
    const second = tool({
      name: 'mcp__second__write',
      execute: vi.fn<ToolDefinition['execute']>(
        () =>
          new Promise<Awaited<ReturnType<ToolDefinition['execute']>>>((resolve) => {
            resolveSecond = () => resolve({ content: [{ type: 'text', text: 'done' }], details: undefined })
          })
      )
    })
    const exec = codeModeTools([first, second]).find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!

    const result = exec.execute(
      'outer-1',
      {
        code: `tools.invoke('mcp__first__lookup', {}).then(() => tools.invoke('mcp__second__write', {})); return 'queued'`
      },
      undefined,
      undefined,
      {} as never
    )
    await vi.waitFor(() => expect(second.execute).toHaveBeenCalledOnce())
    resolveSecond()

    await expect(result).resolves.toMatchObject({ details: { result: 'queued' } })
  })

  it('serializes nested authorization while allowing accepted tools to run in parallel', async () => {
    const resolvers: Array<() => void> = []
    const authorize = vi.fn<PiToolAuthorizer>(
      () =>
        new Promise((resolve) => {
          resolvers.push(() => resolve(undefined))
        })
    )
    const first = tool({ name: 'mcp__first__mutate' })
    const second = tool({ name: 'mcp__second__mutate' })
    const exec = codeModeTools([first, second], new Set(), authorize).find(
      (item) => item.name === PI_TOOL_EXEC_TOOL_NAME
    )!

    const result = exec.execute(
      'outer-1',
      {
        code: `return await parallel(tools.invoke('mcp__first__mutate', {}), tools.invoke('mcp__second__mutate', {}))`
      },
      undefined,
      undefined,
      {} as never
    )
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledTimes(1))
    expect(first.execute).not.toHaveBeenCalled()
    expect(second.execute).not.toHaveBeenCalled()

    resolvers[0]()
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledTimes(2))
    expect(first.execute).toHaveBeenCalledOnce()
    expect(second.execute).not.toHaveBeenCalled()
    resolvers[1]()

    await expect(result).resolves.toMatchObject({ details: { result: expect.any(Array) } })
    expect(second.execute).toHaveBeenCalledOnce()
  })

  it('blocks a tool disabled after the code-mode catalog was created', async () => {
    const name = 'mcp__github__delete_issue'
    const disabled = new Set<string>()
    const inner = tool({ name })
    const exec = codeModeTools([inner], disabled).find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!
    disabled.add(name)

    await expect(
      exec.execute('outer-1', { code: `return await tools.invoke('${name}', {})` }, undefined, undefined, {} as never)
    ).rejects.toThrow(`Tool "${name}" is disabled for this agent.`)
    expect(inner.execute).not.toHaveBeenCalled()
  })

  it('does not execute a nested tool denied by the Pi approval policy', async () => {
    const name = 'mcp__cherry-tools__kb_manage'
    const inner = tool({ name })
    const authorize = vi.fn<PiToolAuthorizer>(async () => ({ block: true, reason: 'User denied permission.' }))
    const exec = codeModeTools([inner], new Set(), authorize).find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!

    await expect(
      exec.execute(
        'outer-1',
        { code: `return await tools.invoke('${name}', { action: 'delete' })` },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow('User denied permission.')
    expect(authorize).toHaveBeenCalledOnce()
    expect(inner.execute).not.toHaveBeenCalled()
  })
})
