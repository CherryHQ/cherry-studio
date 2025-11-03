import type { Tool } from '@types'

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
