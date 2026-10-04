import { DIRECT_TOOL_CALL, experimental_codeModeTool, type CodeModeOptions } from '@ai-sdk/code-mode'
import type { ToolSet } from 'ai'

export const CODE_MODE_TOOL_NAME = 'code_mode'

export function createCodeModeExposition(tools: ToolSet | undefined, options: CodeModeOptions = {}) {
  const eligible = Object.entries(tools ?? {}).filter(
    ([, tool]) => tool.execute && tool.type !== 'provider' && !tool.needsApproval
  )
  if (!tools || Object.hasOwn(tools, CODE_MODE_TOOL_NAME) || eligible.length === 0) return { tools }

  const codeMode = experimental_codeModeTool({ ...options, toolDiscovery: 'conversation' })
  codeMode.description +=
    '\nPrograms have a 30-second deadline. Use direct tool calls for long operations such as image generation or editing. Completed child calls are not rolled back when a program fails; do not repeat their effects.'

  return {
    tools: {
      ...tools,
      [CODE_MODE_TOOL_NAME]: codeMode
    },
    experimental_toolCallers: Object.fromEntries(
      eligible.map(([name]) => [name, [DIRECT_TOOL_CALL, CODE_MODE_TOOL_NAME]])
    )
  }
}
