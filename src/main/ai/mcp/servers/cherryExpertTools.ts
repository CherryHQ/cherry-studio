/**
 * ask_expert tool hosted by the in-process `cherry-tools` MCP server.
 *
 * Owns the per-session consultation budget and the model-facing result envelope;
 * the model call and prompt contract live in `@main/ai/tools/askExpert`.
 */

import type { CallToolResult, McpServer } from '@modelcontextprotocol/server'

import { ASK_EXPERT_MAX_USES, askExpert, formatAskExpertResult } from '@main/ai/tools/askExpert'
import { ASK_EXPERT_DESCRIPTION, ASK_EXPERT_TOOL_NAME, askExpertInputSchema } from '@shared/ai/builtinTools'

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

export function registerExpertTools(server: McpServer, ctx: { agentId: string }): void {
  // One server instance per session connection, so this is the session's budget.
  let uses = 0

  server.registerTool(
    ASK_EXPERT_TOOL_NAME,
    { description: ASK_EXPERT_DESCRIPTION, inputSchema: askExpertInputSchema },
    async (input, callCtx): Promise<CallToolResult> => {
      if (uses >= ASK_EXPERT_MAX_USES) {
        return errorResult(
          `[ask_expert:max_uses_exceeded] The expert call budget for this session is exhausted ` +
            `(max ${ASK_EXPERT_MAX_USES}). Proceed with the advice already given.`
        )
      }

      uses += 1
      const result = await askExpert(input, { agentId: ctx.agentId, signal: callCtx.mcpReq.signal })

      if (!result.ok) {
        // A missing setting never reaches the provider, so it must not consume budget.
        if (result.code === 'not_configured') uses -= 1
        return errorResult(`[ask_expert:${result.code}] ${result.message}`)
      }

      return { content: [{ type: 'text', text: formatAskExpertResult(result, uses, ASK_EXPERT_MAX_USES) }] }
    }
  )
}
