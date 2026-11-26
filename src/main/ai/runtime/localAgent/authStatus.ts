import { stripVTControlCharacters } from 'node:util'

import { CommandFailedError, executeCommand } from '@main/utils/processRunner'
import { getShellEnv } from '@main/utils/shellEnv'
import { LOCAL_CLI_AGENT_PRESETS, type LocalAgentConfiguration } from '@shared/ai/localAgent'
import type { OutputFor } from '@shared/ipc/types'

import { resolveLocalAgentCli } from './launch'

type AuthStatus = OutputFor<'ai.local_agents.auth_status'>

export async function getCursorApiKey(config: LocalAgentConfiguration, signal?: AbortSignal) {
  return config.env.CURSOR_API_KEY ?? (await getShellEnv(signal)).CURSOR_API_KEY
}

export async function getLocalAgentAuthStatus(config: LocalAgentConfiguration): Promise<AuthStatus> {
  if (config.protocol === 'cursor') {
    try {
      const { cursorAuthStatus } = await import('@cherrystudio/agent-runtime-cursor')
      return await cursorAuthStatus(await getCursorApiKey(config))
    } catch {
      return 'unknown'
    }
  }
  const preset = LOCAL_CLI_AGENT_PRESETS.find(
    (entry) => entry.id === config.presetId && entry.protocol === config.protocol
  )
  const probe = preset?.authStatus
  if (!preset || !probe) return 'unsupported'
  if (
    config.args.length &&
    (config.args.length !== preset.args.length || config.args.some((arg, i) => arg !== preset.args[i]))
  )
    return 'unsupported'
  try {
    const launch = await resolveLocalAgentCli(config)
    return await executeCommand(launch.executable, [...probe.args], {
      env: launch.env,
      includeStderr: probe.includeStderr ?? false,
      timeout: 10000,
      maxOutputBytes: 16384
    }).then(
      (output) => probe.parse(stripVTControlCharacters(output)),
      (error: unknown) => {
        if (error instanceof CommandFailedError && error.code === 1) {
          const output = probe.includeStderr ? [error.stdout, error.stderr].join('\n') : error.stdout
          if (probe.parse(stripVTControlCharacters(output)) === 'signed-out') return 'signed-out'
        }
        return 'unknown'
      }
    )
  } catch {
    return 'unknown'
  }
}
