import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { readUIMessageStream } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { getConvertedDocumentArtifacts } from '@shared/ai/documentConversionTool'
import {
  PI_TOOL_CALL_TOOL_NAME,
  PI_TOOL_DESCRIBE_TOOL_NAME,
  PI_TOOL_EXEC_TOOL_NAME,
  PI_TOOL_SEARCH_TOOL_NAME
} from '@shared/ai/piBuiltinTools'
import type { CherryUIMessage, CherryUIMessageChunk } from '@shared/data/types/message'

import type { PiToolAuthorizer } from './approvalExtension'
import { createPiCodeModeTools } from './piCodeMode'
import type { PiMcpToolDefinition } from './piMcpToolAdapter'
import { PiStreamAdapter } from './piStreamAdapter'

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

function codeModeTools(
  catalog: PiMcpToolDefinition[],
  disabled = new Set<string>(),
  authorize: PiToolAuthorizer = async ({ toolName }) =>
    disabled.has(toolName) ? { block: true, reason: `Tool "${toolName}" is disabled for this agent.` } : undefined
) {
  return createPiCodeModeTools(catalog, (name) => disabled.has(name), authorize)
}

describe('createPiCodeModeTools', () => {
  it.each([
    { ending: "return 'Finished'", successful: true, error: undefined },
    {
      ending: "await tools.invoke('convert', { output_path: 'failed.pdf' }); return 'unreachable'",
      successful: true,
      error: 'conversion failed'
    },
    { ending: '', successful: true, error: 'add an explicit return' },
    { ending: 'const cycle = {}; cycle.self = cycle; return cycle', successful: true, error: 'JSON-serializable' },
    { ending: '', successful: false, error: 'conversion failed' }
  ])(
    'persists successful child receipts independently of the outer result: $ending',
    async ({ ending, successful, error }) => {
      const name = 'mcp__cherry-tools__convert_to_document'
      const converter = tool({
        name,
        execute: async (_id, params) => {
          const outputPath = (params as { output_path: string }).output_path
          if (outputPath === 'failed.pdf') throw new Error('conversion failed')
          return {
            content: [
              { type: 'text', text: JSON.stringify({ path: outputPath, format: 'pdf', mime: 'application/pdf' }) }
            ],
            details: null
          }
        }
      })
      const unrelated = tool({
        name: 'mcp__example__read',
        execute: async () => ({
          content: [
            { type: 'text', text: JSON.stringify({ path: 'unrelated.pdf', format: 'pdf', mime: 'application/pdf' }) }
          ],
          details: null
        })
      })
      const exec = codeModeTools([converter, unrelated]).find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!
      const input = {
        code: `await tools.invoke('${name}', { output_path: '${successful ? 'one.pdf' : 'failed.pdf'}' }); await tools.invoke('mcp__example__read', {}); ${ending.replace("'convert'", `'${name}'`)}`
      }
      const chunks: CherryUIMessageChunk[] = []
      const adapter = new PiStreamAdapter({ enqueue: (chunk) => chunks.push(chunk) })
      adapter.handleEvent({
        type: 'tool_execution_start',
        toolCallId: 'documents',
        toolName: PI_TOOL_EXEC_TOOL_NAME,
        args: input
      })
      const execution = exec.execute(
        'documents',
        input,
        undefined,
        (partialResult) => {
          const update = {
            type: 'tool_execution_update' as const,
            toolCallId: 'documents',
            toolName: PI_TOOL_EXEC_TOOL_NAME,
            args: input,
            partialResult
          }
          adapter.handleEvent(update)
          adapter.handleEvent(update)
        },
        {} as never
      )
      if (!error) {
        const result = await execution
        adapter.handleEvent({
          type: 'tool_execution_end',
          toolCallId: 'documents',
          toolName: PI_TOOL_EXEC_TOOL_NAME,
          result,
          isError: false
        })
      } else {
        await expect(execution).rejects.toThrow(error)
        adapter.handleEvent({
          type: 'tool_execution_end',
          toolCallId: 'documents',
          toolName: PI_TOOL_EXEC_TOOL_NAME,
          result: { content: [{ type: 'text', text: error }] },
          isError: true
        })
      }
      const stream = new ReadableStream<CherryUIMessageChunk>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk)
          controller.close()
        }
      })
      let message: CherryUIMessage | undefined
      for await (const snapshot of readUIMessageStream<CherryUIMessage>({ stream })) message = snapshot
      const persisted: CherryUIMessage = JSON.parse(JSON.stringify(message))
      const parts = persisted.parts.filter((part) => part.type === 'dynamic-tool')
      expect(parts.find((part) => part.toolCallId === 'documents')?.state).toBe(
        error ? 'output-error' : 'output-available'
      )
      const children = parts.filter((part) => part.toolCallId !== 'documents')
      expect(children).toHaveLength(successful ? 2 : 0)
      expect(new Set(children.map((part) => part.toolCallId)).size).toBe(children.length)
      for (const child of children) {
        expect(child.state).toBe('output-available')
        expect(child.callProviderMetadata?.cherry?.parentToolCallId).toBe('documents')
      }
      expect(parts.flatMap((part) => getConvertedDocumentArtifacts(part.toolName, part.input, part.output))).toEqual(
        successful ? [{ path: 'one.pdf', format: 'pdf', mime: 'application/pdf' }] : []
      )
    }
  )

  it('publishes a completed child before an invalid declared output fails decoding', async () => {
    const output = { content: [{ type: 'text' as const, text: 'saved' }], details: undefined }
    const exec = codeModeTools([
      {
        ...tool({ name: 'save', execute: async () => output }),
        outputSchema: { type: 'object' }
      }
    ]).find((item) => item.name === PI_TOOL_EXEC_TOOL_NAME)!
    const updates: unknown[] = []
    await expect(
      exec.execute(
        'save-parent',
        { code: 'return await tools.invoke("save", {})' },
        undefined,
        (update) => updates.push(update),
        {} as never
      )
    ).rejects.toThrow('invalid JSON')
    expect(updates).toEqual([
      {
        content: [],
        details: {
          childToolResult: {
            toolCallId: expect.stringContaining('save-parent::exec::'),
            toolName: 'save',
            input: {},
            output
          }
        }
      }
    ])
  })

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
