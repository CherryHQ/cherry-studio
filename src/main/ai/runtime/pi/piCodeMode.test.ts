import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import {
  PI_TOOL_CALL_TOOL_NAME,
  PI_TOOL_DESCRIBE_TOOL_NAME,
  PI_TOOL_EXEC_TOOL_NAME,
  PI_TOOL_SEARCH_TOOL_NAME
} from '@shared/ai/piBuiltinTools'
import { describe, expect, it, vi } from 'vitest'

import type { PiToolAuthorizer } from './approvalExtension'
import { createPiCodeModeTools } from './piCodeMode'

function tool(overrides: Partial<ToolDefinition> & Pick<ToolDefinition, 'name'>): ToolDefinition {
  return {
    label: overrides.name,
    description: `${overrides.name} description`,
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query']
    } as ToolDefinition['parameters'],
    execute: vi.fn<ToolDefinition['execute']>(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
      details: { ok: true }
    })),
    ...overrides
  }
}

function codeModeTools(
  catalog: ToolDefinition[],
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
    const tools = codeModeTools([tool({ name, description: 'Find repository issues', execute })], new Set(), authorize)
    const describe = tools.find((item) => item.name === PI_TOOL_DESCRIBE_TOOL_NAME)!
    const call = tools.find((item) => item.name === PI_TOOL_CALL_TOOL_NAME)!

    const description = await describe.execute('describe-1', { name }, undefined, undefined, {} as never)
    await call.execute('call-1', { name, params: { query: 'bug' } }, undefined, undefined, {} as never)

    expect(description.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Find repository issues')
    })
    expect(description.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining(`invoke(name: "${name}"`)
    })
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: name, toolCallId: 'call-1::call', input: { query: 'bug' } })
    )
    expect(execute).toHaveBeenCalledWith('call-1::call', { query: 'bug' }, undefined, undefined, expect.anything())
  })

  it('executes a discovered tool through tools.invoke with nested call identity and cancellation', async () => {
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
        toolCallId: expect.stringMatching(/^outer-1::exec::/),
        input: { query: 'bug' },
        signal: expect.any(AbortSignal)
      })
    )
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('found') })
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
