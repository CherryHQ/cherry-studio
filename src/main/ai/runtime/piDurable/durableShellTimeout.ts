import type { createBashTool } from '@earendil-works/pi-durable/tools'

import { PI_SHELL_TIMEOUT_SECONDS } from '../pi/piShellTimeout'

type ShellTool = ReturnType<typeof createBashTool>

export function withDurableShellTimeout(tool: ShellTool): ShellTool {
  const properties = tool.parameters.properties as Record<string, object>
  return {
    ...tool,
    description: `${tool.description} Commands default to a 120-second timeout; set timeout explicitly for longer work.`,
    parameters: {
      ...tool.parameters,
      properties: {
        ...properties,
        timeout: { ...properties.timeout, description: 'Timeout in seconds (default: 120)' }
      }
    },
    execute: (args, api, context) =>
      tool.execute({ ...args, timeout: args.timeout ?? PI_SHELL_TIMEOUT_SECONDS }, api, context)
  }
}
