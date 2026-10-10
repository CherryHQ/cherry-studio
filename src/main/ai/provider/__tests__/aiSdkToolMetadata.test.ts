import type { LanguageModelV3StreamPart, LanguageModelV3Usage } from '@ai-sdk/provider'
import { readUIMessageStream, streamText, tool, type UIMessage, type UIMessageChunk } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

const TOOL_METADATA = {
  cherry: {
    tool: {
      name: '原始工具名',
      description: '测试 MCP 工具',
      serverId: 'server-1',
      serverName: '测试服务器',
      type: 'mcp'
    }
  }
} as const

const USAGE: LanguageModelV3Usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined }
}

function createToolCallModel(): MockLanguageModelV3 {
  const parts: LanguageModelV3StreamPart[] = [
    {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'lookup',
      input: JSON.stringify({ query: 'hello' })
    },
    {
      type: 'finish',
      finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
      usage: USAGE
    }
  ]

  return new MockLanguageModelV3({
    doStream: async () => ({ stream: convertArrayToReadableStream(parts) })
  })
}

async function readFinalMessage(stream: ReadableStream<UIMessageChunk>): Promise<UIMessage> {
  let finalMessage: UIMessage | undefined
  for await (const message of readUIMessageStream({ stream })) finalMessage = message
  if (!finalMessage) throw new Error('Expected the UI message stream to emit a message')
  return finalMessage
}

function findToolPart(message: UIMessage) {
  const part = message.parts.find((part) => 'toolCallId' in part && part.toolCallId === 'call-1')
  if (!part) throw new Error('Expected the UI message to contain the tool call')
  return part
}

// Guards `Tool.metadata` reaching UI message parts as `toolMetadata`. Upstream
// support landed in vercel/ai@f591416 (ai@6.0.176); before that the field
// typechecked and silently did nothing, so this must fail on a downgrade.
describe('AI SDK tool metadata propagation', () => {
  it('preserves metadata on approval-requested UI message parts', async () => {
    const result = streamText({
      model: createToolCallModel(),
      prompt: 'test',
      tools: {
        lookup: tool({
          description: 'Look up a value',
          inputSchema: z.object({ query: z.string() }),
          metadata: TOOL_METADATA,
          needsApproval: true,
          execute: async () => ({ ok: true })
        })
      }
    })

    const part = findToolPart(await readFinalMessage(result.toUIMessageStream()))

    expect(part).toMatchObject({
      type: 'tool-lookup',
      state: 'approval-requested',
      toolMetadata: TOOL_METADATA
    })
  })

  it('preserves metadata on output-error UI message parts', async () => {
    const result = streamText({
      model: createToolCallModel(),
      prompt: 'test',
      tools: {
        lookup: tool({
          description: 'Look up a value',
          inputSchema: z.object({ query: z.string() }),
          metadata: TOOL_METADATA,
          execute: async (): Promise<{ ok: boolean }> => {
            throw new Error('tool failed')
          }
        })
      }
    })

    const part = findToolPart(
      await readFinalMessage(
        result.toUIMessageStream({ onError: (error) => (error instanceof Error ? error.message : String(error)) })
      )
    )

    expect(part).toMatchObject({
      type: 'tool-lookup',
      state: 'output-error',
      errorText: 'tool failed',
      toolMetadata: TOOL_METADATA
    })
  })
})
