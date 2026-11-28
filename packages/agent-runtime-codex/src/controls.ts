import type { CodexAppServerClient, CodexRequestParams } from './appServerClient'

export class CodexControls {
  plan = false
  goals = false
  collaboration?: 'default' | 'plan'

  async discover(client: CodexAppServerClient, threadId: string, model?: string) {
    const [presets, goals] = await Promise.all([
      model ? client.request('collaborationMode/list', {}).catch(() => undefined) : undefined,
      this.enabledGoals(client, threadId).catch(() => false)
    ])
    this.plan = !!presets?.data.some((p) => p.mode === 'plan') && presets.data.some((p) => p.mode === 'default')
    this.goals = goals
  }

  private async enabledGoals(client: CodexAppServerClient, threadId: string) {
    let cursor: string | null | undefined
    do {
      const page = await client.request('experimentalFeature/list', { threadId, cursor })
      const goals = page.data.find((feature) => feature.name === 'goals')
      if (goals) return goals.enabled
      cursor = page.nextCursor
    } while (cursor)
    return false
  }

  turnSettings(
    model: string | undefined,
    effort?: string
  ): Pick<CodexRequestParams['turn/start'], 'collaborationMode'> {
    if (!this.plan || !this.collaboration || !model) return {}
    return {
      collaborationMode: {
        mode: this.collaboration,
        settings: { model, reasoning_effort: effort ?? null, developer_instructions: null }
      }
    }
  }

  async goalCommand(client: CodexAppServerClient, threadId: string, args: string) {
    if (args === 'clear') {
      const { cleared } = await client.request('thread/goal/clear', { threadId, origin: 'user' })
      return cleared ? 'Goal cleared.' : 'No goal set.'
    }
    const { goal } = !args
      ? await client.request('thread/goal/get', { threadId })
      : await client.request('thread/goal/set', {
          threadId,
          origin: 'user',
          ...(args === 'pause' ? { status: 'paused' } : args === 'resume' ? { status: 'active' } : { objective: args })
        })
    if (goal && goal.threadId !== threadId) throw new Error('Codex returned another thread’s goal')
    return goal ? `${goal.objective} (${goal.status})` : 'No goal set.'
  }
}
