import type { RuntimeCommandCatalog } from '@cherrystudio/agent-runtime'

export const claudeCommandCatalog = {
  liveCatalog: 'query',
  builtinCommands: [
    { name: 'clear', description: 'Start a new conversation with empty context', argumentHint: '', builtin: true },
    {
      name: 'compact',
      description: 'Free up context by summarizing the conversation so far',
      argumentHint: '',
      builtin: true
    },
    {
      name: 'context',
      description: 'Visualize current context usage as a colored grid',
      argumentHint: '',
      builtin: true
    },
    {
      name: 'usage',
      description: 'Show session cost, plan usage limits, and activity stats',
      argumentHint: '',
      builtin: true
    }
  ]
} as const satisfies RuntimeCommandCatalog

export const localClaudeBuiltinCommands = [
  ...claudeCommandCatalog.builtinCommands,
  {
    name: 'goal',
    description: 'Set a goal to work toward until it is completed',
    argumentHint: '<goal>',
    builtin: true
  }
] as const
