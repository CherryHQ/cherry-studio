import type { Tool } from '@types'

export const POWERSHELL_TOOL_ID = 'PowerShell'

// https://docs.anthropic.com/en/docs/claude-code/settings#tools-available-to-claude
export const builtinTools: Tool[] = [
  {
    id: 'Bash',
    name: 'Bash',
    description: 'Executes shell commands in your environment',
    requirePermissions: true,
    type: 'builtin'
  },
  {
    id: 'Edit',
    name: 'Edit',
    description: 'Makes targeted edits to specific files',
    requirePermissions: true,
    type: 'builtin'
  },
  {
    id: 'Glob',
    name: 'Glob',
    description: 'Finds files based on pattern matching',
    requirePermissions: false,
    type: 'builtin'
  },
  {
    id: 'Grep',
    name: 'Grep',
    description: 'Searches for patterns in file contents',
    requirePermissions: false,
    type: 'builtin'
  },
  {
    id: 'MultiEdit',
    name: 'MultiEdit',
    description: 'Performs multiple edits on a single file atomically',
    requirePermissions: true,
    type: 'builtin'
  },
  {
    id: 'NotebookEdit',
    name: 'NotebookEdit',
    description: 'Modifies Jupyter notebook cells',
    requirePermissions: true,
    type: 'builtin'
  },
  {
    id: 'NotebookRead',
    name: 'NotebookRead',
    description: 'Reads and displays Jupyter notebook contents',
    requirePermissions: false,
    type: 'builtin'
  },
  {
    id: POWERSHELL_TOOL_ID,
    name: 'PowerShell',
    description: 'Executes PowerShell commands in your environment',
    requirePermissions: true,
    type: 'builtin'
  },
  { id: 'Read', name: 'Read', description: 'Reads the contents of files', requirePermissions: false, type: 'builtin' },
  {
    id: 'Task',
    name: 'Task',
    description: 'Runs a sub-agent to handle complex, multi-step tasks',
    requirePermissions: false,
    type: 'builtin'
  },
  {
    id: 'TodoWrite',
    name: 'TodoWrite',
    description: 'Creates and manages structured task lists',
    requirePermissions: false,
    type: 'builtin'
  },
  {
    id: 'WebFetch',
    name: 'WebFetch',
    description: 'Fetches content from a specified URL',
    requirePermissions: true,
    type: 'builtin'
  },
  {
    id: 'WebSearch',
    name: 'WebSearch',
    description: 'Performs web searches with domain filtering',
    requirePermissions: true,
    type: 'builtin'
  },
  { id: 'Write', name: 'Write', description: 'Creates or overwrites files', requirePermissions: true, type: 'builtin' }
]

export const getExposedBuiltinTools = (platform: NodeJS.Platform = process.platform): Tool[] =>
  platform === 'win32' ? builtinTools : builtinTools.filter((tool) => tool.id !== POWERSHELL_TOOL_ID)

/**
 * Build a runtime-only copy of persisted allowed tool IDs.
 *
 * PowerShell remains an opaque, round-trippable persisted ID on every platform,
 * but it must not become executable through either Claude runtime authorization
 * channel outside Windows.
 */
export const getRuntimeAllowedTools = (
  allowedTools: readonly string[] | undefined,
  platform: NodeJS.Platform = process.platform
): string[] | undefined => {
  if (!allowedTools) {
    return undefined
  }

  return platform === 'win32' ? [...allowedTools] : allowedTools.filter((toolId) => toolId !== POWERSHELL_TOOL_ID)
}
