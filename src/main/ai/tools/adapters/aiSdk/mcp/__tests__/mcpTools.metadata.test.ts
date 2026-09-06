/**
 * Contract test for the AI SDK feature the renderer's tool cards depend on:
 * `Tool.metadata` must reach the UI parts as `toolMetadata`, including the
 * states that have no output yet. `ai` only implements this from 6.0.185 —
 * on older versions the field typechecks and silently does nothing, so
 * asserting it on a hand-built part proves nothing. This drives a real
 * `streamText` instead.
 */

import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { readUIMessageStream, streamText } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToolRegistry } from '../../registry'

const listTools = vi.fn()
const list = vi.fn()
const callTool = vi.fn()

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'McpCatalogService') return { listTools }
      if (name === 'McpRuntimeService') return { callTool }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

vi.mock('@main/data/services/McpServerService', () => ({
  mcpServerService: { list, getById: (id: string) => ({ id, name: '票据 OCR', isActive: true }) }
}))

const { syncMcpToolsToRegistry } = await import('../mcpTools')

const WIRE_ID = 'mcp__piaoJuOcr__shiBieFaPiao_0123456789abcdef0123'

function mockModelEmittingToolCall() {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
        { type: 'stream-start', warnings: [] },
        { type: 'tool-call', toolCallId: 'call-1', toolName: WIRE_ID, input: '{}' },
        {
          type: 'finish',
          finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 }
          }
        }
      ])
    })
  })
}

describe('MCP tool metadata reaches the UI parts', () => {
  beforeEach(() => {
    listTools.mockReset()
    list.mockReset()
    callTool.mockReset()
    list.mockReturnValue({ items: [{ id: 'server-a', name: '票据 OCR', isActive: true }] })
    listTools.mockReturnValue([
      {
        id: WIRE_ID,
        serverId: 'server-a',
        serverName: '票据 OCR',
        name: '识别发票',
        description: '识别票据中的结构化字段',
        inputSchema: { type: 'object', properties: {} }
      }
    ])
    callTool.mockResolvedValue({ isError: false, content: [{ type: 'text', text: 'ok' }] })
  })

  it('carries the raw display name on every tool part, not just the completed one', async () => {
    const reg = new ToolRegistry()
    await syncMcpToolsToRegistry(reg)
    const entry = reg.getByName(WIRE_ID)
    expect(entry).toBeDefined()

    const result = streamText({
      model: mockModelEmittingToolCall(),
      tools: { [WIRE_ID]: entry!.tool },
      prompt: 'read the invoice'
    })

    const states = new Map<string, unknown>()
    for await (const message of readUIMessageStream({ stream: result.toUIMessageStream() })) {
      for (const part of message.parts) {
        if (!('toolCallId' in part) || part.toolCallId !== 'call-1') continue
        states.set(part.state as string, (part as { toolMetadata?: unknown }).toolMetadata)
      }
    }

    // The pre-output states are the ones that used to fall back to the hashed wire id.
    expect(states.has('input-available')).toBe(true)
    for (const [state, toolMetadata] of states) {
      expect(toolMetadata, `state ${state} lost its tool metadata`).toMatchObject({
        cherry: { tool: { name: '识别发票', serverName: '票据 OCR', serverId: 'server-a', type: 'mcp' } }
      })
    }
  })
})
