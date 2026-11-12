import type { createBashToolDefinition } from '@earendil-works/pi-coding-agent'

/** Keep unbounded commands from holding a turn after their useful work has finished. */
type ShellTool = ReturnType<typeof createBashToolDefinition>

export function withPiShellTimeout(tool: ShellTool): ShellTool {
  return {
    ...tool,
    description: `${tool.description} Commands default to a 120-second timeout; set timeout explicitly for longer work.`,
    parameters: {
      ...tool.parameters,
      properties: {
        ...tool.parameters.properties,
        timeout: Object.assign({}, tool.parameters.properties.timeout, {
          description: 'Timeout in seconds (default: 120)'
        })
      }
    },
    execute: (id, args, signal, onUpdate, context) =>
      tool.execute(id, { ...args, timeout: args.timeout ?? 120 }, signal, onUpdate, context)
  }
}
