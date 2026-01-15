import type { Tool, ToolEnvironment } from '@types'

/**
 * Environment constants for tool compatibility.
 * - ELECTRON_ONLY: Tools that require Node.js/filesystem/shell access
 * - ALL_ENVIRONMENTS: Tools that work in both Electron and browser
 */
const ELECTRON_ONLY: ToolEnvironment[] = ['electron']
const ALL_ENVIRONMENTS: ToolEnvironment[] = ['electron', 'browser']

// https://docs.anthropic.com/en/docs/claude-code/settings#tools-available-to-claude
export const builtinTools: Tool[] = [
  // === Electron-only tools (require Node.js/filesystem/shell) ===
  {
    id: 'Bash',
    name: 'Bash',
    description: 'Executes shell commands in your environment',
    requirePermissions: true,
    type: 'builtin',
    supportedEnvironments: ELECTRON_ONLY // Requires child_process
  },
  {
    id: 'Edit',
    name: 'Edit',
    description: 'Makes targeted edits to specific files',
    requirePermissions: true,
    type: 'builtin',
    supportedEnvironments: ELECTRON_ONLY // Requires filesystem
  },
  {
    id: 'Glob',
    name: 'Glob',
    description: 'Finds files based on pattern matching',
    requirePermissions: false,
    type: 'builtin',
    supportedEnvironments: ELECTRON_ONLY // Requires filesystem
  },
  {
    id: 'Grep',
    name: 'Grep',
    description: 'Searches for patterns in file contents',
    requirePermissions: false,
    type: 'builtin',
    supportedEnvironments: ELECTRON_ONLY // Requires filesystem
  },
  {
    id: 'MultiEdit',
    name: 'MultiEdit',
    description: 'Performs multiple edits on a single file atomically',
    requirePermissions: true,
    type: 'builtin',
    supportedEnvironments: ELECTRON_ONLY // Requires filesystem
  },
  {
    id: 'NotebookEdit',
    name: 'NotebookEdit',
    description: 'Modifies Jupyter notebook cells',
    requirePermissions: true,
    type: 'builtin',
    supportedEnvironments: ELECTRON_ONLY // Requires filesystem
  },
  {
    id: 'NotebookRead',
    name: 'NotebookRead',
    description: 'Reads and displays Jupyter notebook contents',
    requirePermissions: false,
    type: 'builtin',
    supportedEnvironments: ELECTRON_ONLY // Requires filesystem
  },
  {
    id: 'Read',
    name: 'Read',
    description: 'Reads the contents of files',
    requirePermissions: false,
    type: 'builtin',
    supportedEnvironments: ELECTRON_ONLY // Requires filesystem
  },
  {
    id: 'Task',
    name: 'Task',
    description: 'Runs a sub-agent to handle complex, multi-step tasks',
    requirePermissions: false,
    type: 'builtin',
    supportedEnvironments: ALL_ENVIRONMENTS // Sub-agents can use browser-compatible tools
  },
  {
    id: 'Write',
    name: 'Write',
    description: 'Creates or overwrites files',
    requirePermissions: true,
    type: 'builtin',
    supportedEnvironments: ELECTRON_ONLY // Requires filesystem
  },

  // === Cross-environment tools (work in both Electron and browser) ===
  {
    id: 'TodoWrite',
    name: 'TodoWrite',
    description: 'Creates and manages structured task lists',
    requirePermissions: false,
    type: 'builtin',
    supportedEnvironments: ALL_ENVIRONMENTS // In-memory/state-based
  },
  {
    id: 'WebFetch',
    name: 'WebFetch',
    description: 'Fetches content from a specified URL',
    requirePermissions: true,
    type: 'builtin',
    supportedEnvironments: ALL_ENVIRONMENTS // Uses fetch API
  },
  {
    id: 'WebSearch',
    name: 'WebSearch',
    description: 'Performs web searches with domain filtering',
    requirePermissions: true,
    type: 'builtin',
    supportedEnvironments: ALL_ENVIRONMENTS // API-based
  }
]
