import { once } from 'node:events'
import { resolve } from 'node:path'

import {
  query,
  type ModelInfo,
  type Options,
  type Query,
  type SpawnedProcess,
  type SpawnOptions
} from '@anthropic-ai/claude-agent-sdk'

import type {
  RuntimeEffortControl,
  RuntimeModelOption,
  SubscriptionUsageResult,
  SubscriptionUsageWindow
} from '@cherrystudio/agent-runtime'
import type { InstalledCli } from '@cherrystudio/agent-runtime/cli'
import type { LaunchSpec } from '@cherrystudio/agent-runtime/stdio'

import type { claudeCli } from './cli'

export interface LocalClaudeLaunch extends Omit<LaunchSpec, 'executable'> {
  readonly installation: InstalledCli<typeof claudeCli.executable>
}

type SpawnClaude = (options: SpawnOptions & { detached: boolean }) => SpawnedProcess

export function localClaudeOptions(launch: LocalClaudeLaunch, abortController: AbortController, spawn: SpawnClaude) {
  const { cwd, installation, args } = launch
  const env = { ...launch.env }
  if (env.CLAUDE_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = resolve(cwd, env.CLAUDE_CONFIG_DIR)
  else delete env.CLAUDE_CONFIG_DIR
  return {
    cwd,
    abortController,
    pathToClaudeCodeExecutable: installation.path,
    env,
    spawnClaudeCodeProcess: (options) =>
      spawn({ ...options, args: [...options.args, ...args], detached: process.platform !== 'win32' })
  } satisfies Options
}

async function withClaudeProbe<T>(
  launch: LocalClaudeLaunch,
  abortController: AbortController,
  spawn: SpawnClaude,
  join: () => Promise<void> | undefined,
  read: (stream: Query) => Promise<T>,
  probeSettings?: Options['settings']
) {
  abortController.signal.throwIfAborted()
  const done = new AbortController()
  const stream = query({
    prompt: {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            if (!done.signal.aborted) await once(done.signal, 'abort')
            return { done: true, value: undefined }
          }
        }
      }
    },
    options: {
      ...localClaudeOptions(launch, abortController, spawn),
      settingSources: ['user', 'project', 'local'],
      persistSession: false,
      tools: [],
      strictMcpConfig: true,
      ...(probeSettings && { settings: probeSettings })
    }
  })
  try {
    return await read(stream)
  } finally {
    done.abort()
    stream.close()
    await join()
  }
}

export function probeClaudeModels(
  launch: LocalClaudeLaunch,
  abortController: AbortController,
  spawn: SpawnClaude,
  join: () => Promise<void> | undefined
) {
  return withClaudeProbe(launch, abortController, spawn, join, async (stream) => {
    const { models } = await stream.initializationResult()
    return models.map((model): RuntimeModelOption => {
      const options = claudeEffortOptions(model)
      return { id: model.value, name: model.displayName, ...(options.length && { effort: { options } }) }
    })
  })
}

export async function readClaudeSubscriptionUsage(
  launch: LocalClaudeLaunch,
  abortController: AbortController,
  spawn: SpawnClaude,
  join: () => Promise<void> | undefined
): Promise<SubscriptionUsageResult> {
  const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL } = launch.env
  if (ANTHROPIC_API_KEY || ANTHROPIC_AUTH_TOKEN || ANTHROPIC_BASE_URL) return { status: 'unsupported' }
  try {
    return await withClaudeProbe(
      launch,
      abortController,
      spawn,
      join,
      async (stream): Promise<SubscriptionUsageResult> => {
        const account = await stream.accountInfo()
        if (account.apiProvider && account.apiProvider !== 'firstParty') return { status: 'unsupported' }
        if (!account.subscriptionType && !account.tokenSource && !account.email && !account.apiKeySource)
          return { status: 'signed-out' }
        const usage = await stream.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
        if (!usage.rate_limits_available) return { status: 'unsupported' }
        if (!usage.rate_limits) return { status: 'unavailable' }
        const limits = usage.rate_limits
        const windows: SubscriptionUsageWindow[] = []
        const add = (
          id: string,
          label: string,
          durationMinutes: number,
          window: { utilization: number | null; resets_at: string | null } | null | undefined
        ) => {
          if (window?.utilization == null || !Number.isFinite(window.utilization) || window.utilization < 0) return
          const resetsAt = window.resets_at === null ? NaN : Date.parse(window.resets_at)
          windows.push({
            id,
            label,
            durationMinutes,
            usedRatio: window.utilization / 100,
            resetsAt: Number.isFinite(resetsAt) ? resetsAt : undefined
          })
        }
        add('five_hour', 'Claude', 5 * 60, limits.five_hour)
        add('seven_day', 'Claude', 7 * 24 * 60, limits.seven_day)
        add('seven_day_opus', 'Opus', 7 * 24 * 60, limits.seven_day_opus)
        add('seven_day_sonnet', 'Sonnet', 7 * 24 * 60, limits.seven_day_sonnet)
        add('seven_day_oauth_apps', 'Claude Apps', 7 * 24 * 60, limits.seven_day_oauth_apps)
        for (const row of limits.model_scoped ?? [])
          add('model:' + row.display_name, row.display_name, 7 * 24 * 60, row)
        return windows.length ? { status: 'available', readAt: Date.now(), windows } : { status: 'unavailable' }
      },
      { disableAllHooks: true }
    )
  } catch {
    abortController.signal.throwIfAborted()
    return { status: 'unavailable' }
  }
}

type ClaudeEffort = NonNullable<Options['effort']> | 'default'

const effortLabels = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max'
} satisfies Record<NonNullable<Options['effort']>, string>

function claudeEffortOptions(model: ModelInfo | undefined) {
  if (model?.supportsEffort === false) return []
  return model?.supportedEffortLevels?.map((value) => ({ value, name: effortLabels[value] })) ?? []
}

export function claudeEffortControl(
  models: readonly ModelInfo[],
  modelId: string,
  selected: string | undefined
): RuntimeEffortControl<ClaudeEffort> | undefined {
  const model = models.find((entry) => entry.value === modelId || entry.resolvedModel === modelId)
  const advertised = claudeEffortOptions(model)
  if (!advertised.length) return
  const options: RuntimeEffortControl<ClaudeEffort>['options'] = [{ value: 'default', name: 'Default' }, ...advertised]
  return {
    id: 'claude-effort',
    application: 'session',
    modelId,
    currentValue: options.find(({ value }) => value === selected)?.value ?? 'default',
    options
  }
}
