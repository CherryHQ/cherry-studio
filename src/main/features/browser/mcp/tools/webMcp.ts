import { webMcpListSchema, webMcpCallSchema } from '@main/ai/mcp/browserToolDefinitions'

import type { BrowserController } from '../browserController'
import { browserResult } from './result'

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The MCP registry erases per-tool arguments; webMcpListSchema validates the target tab options.
export async function handleListWebTools(controller: BrowserController, args: unknown, signal?: AbortSignal) {
  const input = webMcpListSchema.parse(args ?? {})
  return browserResult(controller, input, signal, (session, options) => session.webTools.list(options))
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The MCP registry erases per-tool arguments; webMcpCallSchema validates the tool id and website-owned argument payload.
export async function handleCallWebTool(controller: BrowserController, args: unknown, signal?: AbortSignal) {
  const input = webMcpCallSchema.parse(args)
  return browserResult(controller, input, signal, (session, options) =>
    session.webTools.call(input.toolId, input.args, options)
  )
}
