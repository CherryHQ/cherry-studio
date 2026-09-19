import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'

import type { McpCallToolResponse } from '@main/ai/mcp/types'
import { type ExecResult, runExecCode } from '@main/ai/tools/codeMode/runtime'

import { isApprovalGated } from '../../isApprovalGated'
import type { ToolRegistry } from '../../registry'

export type { ExecResult }

export interface ExecRuntimeContext {
  registry: ToolRegistry
  parentOptions: ToolExecutionOptions
}

export function runExec(code: string, ctx: ExecRuntimeContext): Promise<ExecResult> {
  return runExecCode(code, {
    abortSignal: ctx.parentOptions.abortSignal,
    async executeTool(name, params, requestId, signal) {
      const entry = ctx.registry.getByName(name)
      if (!entry) throw new Error(`Tool not found: ${name}`)
      const execute = entry.tool.execute
      if (typeof execute !== 'function') throw new Error(`Tool ${name} has no execute handler`)

      // `tool_exec` cannot pause for an interactive approval card mid-loop. Refuse gated tools so
      // the model calls them inline, where the AI SDK owns the approval lifecycle.
      if (
        await isApprovalGated(entry.tool, {
          input: params,
          toolCallId: ctx.parentOptions.toolCallId,
          messages: ctx.parentOptions.messages,
          experimental_context: ctx.parentOptions.experimental_context
        })
      ) {
        throw new Error(`Tool ${name} requires user approval; call it directly instead of via tool_exec.`)
      }

      const value = await execute(params, {
        ...ctx.parentOptions,
        toolCallId: `${ctx.parentOptions.toolCallId}::exec::${requestId}`,
        abortSignal: signal
      })
      const content = (value as Partial<McpCallToolResponse> | null)?.content
      const images = Array.isArray(content)
        ? content.flatMap((part) =>
            part.type === 'image' && typeof part.data === 'string' && typeof part.mimeType === 'string'
              ? [{ data: part.data, mimeType: part.mimeType }]
              : []
          )
        : []
      return { value, ...(images.length > 0 && { images }) }
    }
  })
}
