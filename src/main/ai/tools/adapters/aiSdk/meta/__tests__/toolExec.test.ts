import { jsonSchema } from 'ai'
import { describe, expect, it } from 'vitest'

import { ToolRegistry } from '../../registry'
import { createToolExecTool } from '../toolExec'

describe('tool_exec model output', () => {
  it('keeps JSON output for code without nested images', async () => {
    const tool = createToolExecTool(new ToolRegistry())
    if (!tool.execute) throw new Error('tool_exec must be executable')

    const input = { code: 'return 42' }
    const output = await tool.execute(input, { toolCallId: 'outer-1', messages: [] })

    expect(output).toEqual({ result: 42 })
    expect(tool.toModelOutput?.({ toolCallId: 'outer-1', input, output })).toEqual({
      type: 'json',
      value: { result: 42 }
    })
  })

  it('passes a nested MCP image to the model alongside the code result', async () => {
    const registry = new ToolRegistry()
    registry.register({
      name: 'mcp__s1__screenshot',
      namespace: 'mcp:s1',
      description: 'Capture a screenshot',
      defer: 'auto',
      tool: {
        type: 'function',
        inputSchema: jsonSchema({ type: 'object' }),
        execute: async () => ({
          content: [
            { type: 'text', text: 'captured' },
            { type: 'image', data: 'base64-png', mimeType: 'image/png' }
          ]
        })
      }
    })
    const tool = createToolExecTool(registry)
    if (!tool.execute) throw new Error('tool_exec must be executable')

    const input = {
      code: "const response = await tools.invoke('mcp__s1__screenshot', {}); if (response.content[1].data !== 'base64-png') throw new Error('image missing in worker'); return response"
    }
    const output = await tool.execute(input, { toolCallId: 'outer-1', messages: [] })
    const modelOutput = tool.toModelOutput?.({ toolCallId: 'outer-1', input, output })

    expect(output).toEqual({
      result: {
        content: [
          { type: 'text', text: 'captured' },
          { type: 'image', data: 'base64-png', mimeType: 'image/png' }
        ]
      },
      images: [{ data: 'base64-png', mimeType: 'image/png' }]
    })
    expect(modelOutput).toEqual({
      type: 'content',
      value: [
        { type: 'text', text: JSON.stringify({ result: { content: [{ type: 'text', text: 'captured' }] } }) },
        { type: 'image-data', data: 'base64-png', mediaType: 'image/png' }
      ]
    })
  })
})
