import type * as z from 'zod'

import type { CodexAppServerClient, CodexRequestParams } from './appServerClient'
import type { goalSchema } from './responses'

export class CodexControls {
  plan = false
  goals = false
  collaboration?: 'default' | 'plan'
  goal?: z.output<typeof goalSchema> | null

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

  get canChangeGoalStatus() {
    return this.goals && (this.goal?.status === 'active' || this.goal?.status === 'paused')
  }

  options() {
    const options = []
    if (this.plan)
      options.push({
        type: 'select' as const,
        liveOnly: true as const,
        id: 'collaboration',
        name: 'Collaboration mode',
        currentValue: this.collaboration ?? 'default',
        options: [
          { value: 'default', name: 'Default' },
          { value: 'plan', name: 'Plan' }
        ]
      })
    if (this.goal && this.canChangeGoalStatus)
      options.push({
        type: 'select' as const,
        liveOnly: true as const,
        id: 'goal-status',
        name: this.goal.objective,
        currentValue: this.goal.status,
        options: [
          { value: 'active', name: 'Active' },
          { value: 'paused', name: 'Paused' }
        ]
      })
    return options
  }

  async goalCommand(client: CodexAppServerClient, threadId: string, args: string) {
    if (args === 'clear') {
      const { cleared } = await client.request('thread/goal/clear', { threadId, origin: 'user' }, () => {
        this.goal = null
      })
      return cleared ? 'Goal cleared.' : 'No goal set.'
    }
    const record = (response: { goal: z.output<typeof goalSchema> | null }) => {
      if (response.goal && response.goal.threadId !== threadId) throw new Error('Codex returned another thread’s goal')
      this.goal = response.goal
    }
    const { goal } = !args
      ? await client.request('thread/goal/get', { threadId }, record)
      : await client.request(
          'thread/goal/set',
          {
            threadId,
            origin: 'user',
            ...(args === 'pause'
              ? { status: 'paused' }
              : args === 'resume'
                ? { status: 'active' }
                : { objective: args })
          },
          record
        )
    return goal ? `${goal.objective} (${goal.status})` : 'No goal set.'
  }
}
