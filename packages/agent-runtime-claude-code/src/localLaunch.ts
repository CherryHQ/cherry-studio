import { once } from 'node:events'
import { resolve } from 'node:path'

import {
  query,
  type ModelInfo,
  type Options,
  type SpawnedProcess,
  type SpawnOptions
} from '@anthropic-ai/claude-agent-sdk'

import type { RuntimeEffortControl, RuntimeModelOption } from '@cherrystudio/agent-runtime'
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

export async function probeClaudeModels(
  launch: LocalClaudeLaunch,
  abortController: AbortController,
  spawn: SpawnClaude,
  join: () => Promise<void> | undefined
) {
  abortController.signal.throwIfAborted()
  const done = new AbortController()
  const stream = query({
    prompt: {
      async *[Symbol.asyncIterator]() {
        if (!done.signal.aborted) await once(done.signal, 'abort')
      }
    },
    options: {
      ...localClaudeOptions(launch, abortController, spawn),
      settingSources: ['user', 'project', 'local'],
      persistSession: false,
      tools: [],
      strictMcpConfig: true
    }
  })
  try {
    const { models } = await stream.initializationResult()
    return models.map((model): RuntimeModelOption => {
      const options = claudeEffortOptions(model)
      return { id: model.value, name: model.displayName, ...(options.length && { effort: { options } }) }
    })
  } finally {
    done.abort()
    stream.close()
    await join()
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
