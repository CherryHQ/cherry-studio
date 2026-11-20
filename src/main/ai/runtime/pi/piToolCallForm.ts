import { PI_TOOL_EXEC_TOOL_NAME, PI_TOOL_SEARCH_TOOL_NAME } from '@shared/ai/piBuiltinTools'

import type { ToolCallForm } from '../configToolsGuidance'
import { buildPiMcpToolName } from './piMcpExtension'

const CODEMODE_CALL_FORM: ToolCallForm = {
  ref: (server, name) => `\`await tools.${buildPiMcpToolName(server, name)}({ ... })\``,
  hint: " Call these inside a `codemode` script. To see a tool's parameters, run `return await describeTool('<tool name>')` first; `describeTool` is a script global, not a member of `tools`."
}

const TOOL_SEARCH_CALL_FORM: ToolCallForm = {
  ref: (server, name) => `\`${buildPiMcpToolName(server, name)}\``,
  hint: ' If these tools are not in your tool list yet, load them with `tool_search` first.'
}

/**
 * How a Pi or Pi Durable model reaches Cherry's MCP tools, given the tools the session disabled: a `codemode`
 * script, else `tool_search` where it can load them. Pi exposes MCP tools to codemode only and leaves
 * `tool_search` inactive; Pi Durable defers them, so its `tool_search` loads them. Undefined when neither path is
 * left, so no guidance names tools the model cannot reach.
 */
export function resolvePiToolCallForm(
  disabledTools: ReadonlySet<string>,
  { toolSearchLoadsMcp }: { toolSearchLoadsMcp: boolean }
): ToolCallForm | undefined {
  if (!disabledTools.has(PI_TOOL_EXEC_TOOL_NAME)) return CODEMODE_CALL_FORM
  if (toolSearchLoadsMcp && !disabledTools.has(PI_TOOL_SEARCH_TOOL_NAME)) return TOOL_SEARCH_CALL_FORM
  return undefined
}
