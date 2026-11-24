import { PI_TOOL_EXEC_TOOL_NAME, PI_TOOL_SEARCH_TOOL_NAME } from '@shared/ai/piBuiltinTools'

import { buildPiMcpToolName, isPiToolDisabled } from './piMcpExtension'

/** Pi exposes MCP tools to codemode only. Pi Durable can also load its deferred MCP tools through tool_search. */
export function resolvePiToolCallForm(
  disabledTools: ReadonlySet<string>,
  {
    toolSearchLoadsMcp,
    allowsTool
  }: { toolSearchLoadsMcp: boolean; allowsTool: (server: string, tool: string) => boolean }
) {
  const codemode = !disabledTools.has(PI_TOOL_EXEC_TOOL_NAME)
  if (!codemode && (!toolSearchLoadsMcp || disabledTools.has(PI_TOOL_SEARCH_TOOL_NAME))) return undefined

  return {
    referenceTool(server: string, tool: string): string | undefined {
      const name = buildPiMcpToolName(server, tool)
      if (!allowsTool(server, tool) || isPiToolDisabled(disabledTools, name, { serverName: server, name: tool })) {
        return undefined
      }
      return codemode ? `\`await tools.${name}({ ... })\`` : `\`${name}\``
    },
    toolCallHint: codemode
      ? "Call these inside a `codemode` script. To see a tool's parameters, run `return await describeTool('<tool name>')` first. `describeTool` is a script global."
      : 'If these tools are not in your tool list yet, load them with `tool_search` first.'
  }
}
