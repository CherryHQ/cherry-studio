import { buildBuiltinMcpToolName } from '@shared/ai/builtinMcpToolName'
import { CLAUDE_TOOL_DEFS } from '@shared/ai/claudecode/toolRegistry'

export function expandPiMcpDisabledTools(disabled: Set<string>, runtime: 'pi' | 'pi-durable'): Set<string> {
  const builtins = CLAUDE_TOOL_DEFS.filter((tool) => tool.mcpServer !== undefined).map((tool) => ({
    ...tool,
    nativeName: buildBuiltinMcpToolName(runtime, {
      serverName: tool.mcpServer!,
      toolName: tool.name.slice(`mcp__${tool.mcpServer}__`.length)
    })
  }))
  let changed: boolean
  do {
    changed = false
    for (const tool of builtins) {
      if (disabled.has(tool.nativeName)) continue
      if (
        disabled.has(tool.name) ||
        tool.dependsOn?.some((name) => {
          const dependency = builtins.find((candidate) => candidate.name === name)
          return dependency && (disabled.has(dependency.name) || disabled.has(dependency.nativeName))
        })
      ) {
        disabled.add(tool.nativeName)
        changed = true
      }
    }
  } while (changed)
  return disabled
}
