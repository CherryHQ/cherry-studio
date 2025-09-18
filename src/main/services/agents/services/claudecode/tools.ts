import { Tool } from '@types'

// https://docs.anthropic.com/en/docs/claude-code/settings#tools-available-to-claude
export const builtinTools: Tool[] = [
  { id: 'Bash', name: 'Bash', description: 'Executes shell commands in your environment', requirePermissions: true },
  { id: 'Edit', name: 'Edit', description: 'Makes targeted edits to specific files', requirePermissions: true },
  { id: 'Glob', name: 'Glob', description: 'Finds files based on pattern matching', requirePermissions: false },
  { id: 'Grep', name: 'Grep', description: 'Searches for patterns in file contents', requirePermissions: false },
  {
    id: 'MultiEdit',
    name: 'MultiEdit',
    description: 'Performs multiple edits on a single file atomically',
    requirePermissions: true
  },
  {
    id: 'NotebookEdit',
    name: 'NotebookEdit',
    description: 'Modifies Jupyter notebook cells',
    requirePermissions: true
  },
  {
    id: 'NotebookRead',
    name: 'NotebookRead',
    description: 'Reads and displays Jupyter notebook contents',
    requirePermissions: false
  },
  { id: 'Read', name: 'Read', description: 'Reads the contents of files', requirePermissions: false },
  {
    id: 'Task',
    name: 'Task',
    description: 'Runs a sub-agent to handle complex, multi-step tasks',
    requirePermissions: false
  },
  {
    id: 'TodoWrite',
    name: 'TodoWrite',
    description: 'Creates and manages structured task lists',
    requirePermissions: false
  },
  { id: 'WebFetch', name: 'WebFetch', description: 'Fetches content from a specified URL', requirePermissions: true },
  {
    id: 'WebSearch',
    name: 'WebSearch',
    description: 'Performs web searches with domain filtering',
    requirePermissions: true
  },
  { id: 'Write', name: 'Write', description: 'Creates or overwrites files', requirePermissions: true }
]
