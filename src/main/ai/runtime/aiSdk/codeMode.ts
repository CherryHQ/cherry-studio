import type { CodeModeOptions } from '@ai-sdk/code-mode'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { ToolSet, UIMessageChunk } from 'ai'

import type { McpCallToolResponse } from '@main/ai/mcp/types'
import type { RequestContext } from '@main/ai/tools/adapters/aiSdk/context'
import { createCodeModeExposition } from '@main/ai/tools/adapters/aiSdk/exposition/codeMode'
import { hasMultimodalContent, mcpResultToTextSummary } from '@main/ai/tools/adapters/aiSdk/mcp/utils'

import { safeCall } from './loop/hookRunner'
import type { AgentLoopHooks } from './loop/types'

export function withCodeMode(
  tools: ToolSet | undefined,
  context: RequestContext | undefined,
  hooks: AgentLoopHooks,
  write: (chunk: UIMessageChunk) => void,
  onResult: (toolName: string, toolCallId: string, input: unknown, output: unknown) => Promise<void>
) {
  if (!tools) return { tools }

  const options: CodeModeOptions = {
    toolsContext: Object.fromEntries(Object.keys(tools).map((name) => [name, context])),
    executionPolicy: {
      timeoutMs: 30_000,
      memoryLimitBytes: 64 * 1024 * 1024,
      maxStackSizeBytes: 2 * 1024 * 1024,
      maxResultBytes: 1024 * 1024,
      maxConsoleOutputBytes: 64 * 1024,
      maxSourceBytes: 256 * 1024,
      maxToolInputBytes: 1024 * 1024,
      maxToolOutputBytes: 4 * 1024 * 1024,
      maxBridgeRequests: 256,
      maxInFlightBridgeRequests: 32
    },
    onToolExecutionStart: async ({ toolCall, parentToolCallId, messages }) => {
      const { toolName, toolCallId, input } = toolCall
      const metadata = tools[toolName].metadata
      write({
        type: 'tool-input-available',
        toolCallId,
        toolName,
        input,
        toolMetadata: { ...metadata, cherryCodeMode: { parentToolCallId } }
      })
      await safeCall('onToolExecutionStart', hooks.onToolExecutionStart, {
        callId: toolCallId,
        toolName,
        input,
        messages
      })
    },
    onToolExecutionEnd: async ({ toolCall, messages, toolExecutionMs, toolOutput }) => {
      const { toolName, toolCallId, input } = toolCall
      if (toolOutput.type === 'tool-result') {
        write({ type: 'tool-output-available', toolCallId, output: toolOutput.output })
        await safeCall('codeModeResult', onResult, toolName, toolCallId, input, toolOutput.output)
      } else {
        write({
          type: 'tool-output-error',
          toolCallId,
          errorText: toolOutput.error instanceof Error ? toolOutput.error.message : String(toolOutput.error)
        })
      }
      await safeCall('onToolExecutionEnd', hooks.onToolExecutionEnd, {
        callId: toolCallId,
        toolName,
        input,
        messages,
        durationMs: toolExecutionMs,
        toolOutput
      })
    },
    // Binary content is already delivered through the child result; keep it out of the JS bridge.
    transformToolOutput: ({ output }) => {
      const parsed = CallToolResultSchema.safeParse(output)
      if (!parsed.success) return output
      const result = output as McpCallToolResponse
      if (!hasMultimodalContent(result)) return output
      return {
        ...result,
        content: result.content.map((item) =>
          hasMultimodalContent({ content: [item] })
            ? { type: 'text', text: mcpResultToTextSummary({ content: [item] }) }
            : item
        )
      }
    }
  }
  return createCodeModeExposition(tools, options)
}
