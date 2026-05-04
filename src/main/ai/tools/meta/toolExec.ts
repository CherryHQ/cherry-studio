/**
 * `tool_exec` meta-tool — runs a snippet of JavaScript in an isolated
 * worker thread that can call any registered tool through `tools.invoke`.
 * The replacement for the legacy hub server's `exec`. Useful for fan-out
 * over many MCP tools, light data shaping, and conditional flows that
 * would otherwise need N model round-trips.
 *
 * Globals available inside the user's code:
 *   tools.invoke(name, params)      — call any registered tool, await its result
 *   tools.log(level, msg, fields?)  — structured log entry
 *   parallel(...promises)           — Promise.all
 *   settle(...promises)             — Promise.allSettled
 *   console.log/info/warn/error/debug (captured)
 *
 * The user MUST `return` the final value. Hard timeout: 60s.
 */

import { type Tool, tool } from 'ai'
import * as z from 'zod'

import type { ToolRegistry } from '../registry'
import { runExec } from './exec/runtime'

export const TOOL_EXEC_TOOL_NAME = 'tool_exec'

export function createToolExecTool(registry: ToolRegistry): Tool {
  return tool({
    description:
      'Execute JavaScript that orchestrates multiple tool calls in one round. Use `tools.invoke(name, params)` to call any tool. ' +
      'You MUST explicitly `return` the final value. Available helpers: `parallel(...)`, `settle(...)`, `console.*`, `tools.log(level, msg, fields?)`.',
    inputSchema: z.object({
      code: z
        .string()
        .describe(
          'JavaScript body, runs inside an async wrapper (you can `await` directly). MUST `return` the final value.'
        )
    }),
    inputExamples: [
      {
        input: {
          code: "const [a, b] = await parallel(tools.invoke('fs__read', { path: '/abs/a.ts' }), tools.invoke('fs__read', { path: '/abs/b.ts' }));\nreturn { a, b }"
        }
      }
    ],
    execute: async ({ code }, options) => {
      const result = await runExec(code, { registry, parentOptions: options })
      return {
        result: result.result,
        ...(result.logs && result.logs.length > 0 ? { logs: result.logs } : {}),
        ...(result.error ? { error: result.error } : {}),
        ...(result.isError ? { isError: true } : {})
      }
    }
  })
}
