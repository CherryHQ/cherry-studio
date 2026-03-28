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
