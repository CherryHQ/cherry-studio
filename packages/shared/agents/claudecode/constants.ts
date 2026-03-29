/** Tools disabled for ALL agents — replaced by @cherry/browser MCP */
export const GLOBALLY_DISALLOWED_TOOLS = ['WebSearch', 'WebFetch'] as const

/** Tools disabled when Soul Mode is active (not suited for autonomous operation) */
export const SOUL_MODE_DISALLOWED_TOOLS = [
  'CronCreate',
  'CronDelete',
  'CronList',
  'TodoWrite',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'EnterWorktree',
  'NotebookEdit'
] as const
