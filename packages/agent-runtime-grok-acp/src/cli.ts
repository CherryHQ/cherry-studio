export const grokCli = {
  modelConfig: { tool: 'grok-build', target: 'grok-config', overrides: ['GROK_HOME'] },
  id: 'grok-build',
  name: 'Grok Build',
  protocol: 'acp',
  executable: 'grok',
  args: ['agent', 'stdio'],
  helpUrl: 'https://x.ai/cli'
} as const

/** Grok resolves these roles independently of its default model. Preserve user-pinned roles. */
export function setGrokAuxiliaryModels(
  models: Record<string, unknown>,
  selected: string | undefined,
  summary = selected
): void {
  for (const role of ['session_summary', 'prompt_suggestion'] as const) {
    const current = models[role]
    if (current !== undefined && !(typeof current === 'string' && current.startsWith('cherry-'))) continue
    if (selected?.startsWith('cherry-')) models[role] = role === 'session_summary' ? summary : selected
    else delete models[role]
  }
}
