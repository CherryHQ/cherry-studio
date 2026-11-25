import { stripVTControlCharacters } from 'node:util'

import { CommandFailedError, executeCommand } from '@main/utils/processRunner'
import { getShellEnv } from '@main/utils/shellEnv'
import {
  LOCAL_AGENT_PRESETS,
  localAgentChatProtocol,
  matchesLocalAgentPreset,
  type LocalAgentConfiguration
} from '@shared/ai/localAgent'
import type { OutputFor } from '@shared/ipc/types'

import { resolveLocalAgentLaunch } from './launch'

type AuthStatus = OutputFor<'ai.local_agents.auth_status'>

export function parseCursorAuthStatus(output: string): AuthStatus {
  const text = stripVTControlCharacters(output)
  if (/^\s*[✗✘×]?\s*(Not logged in|Partially authenticated \(missing refresh token\))\s*$/m.test(text))
    return 'signed-out'
  // Cursor also reports success when fetching the account fails; that does not verify authentication.
  if (/^\s*✓\s*Logged in as .+$/m.test(text)) return 'signed-in'
  return 'unknown'
}

export function parseOpenCodeAuthStatus(output: string): AuthStatus {
  const text = stripVTControlCharacters(output).trim()
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return 'unknown'
    const hasConnection = parsed.some((entry) => {
      if (!entry || typeof entry !== 'object') return false
      const connections = (entry as { connections?: unknown }).connections
      return Array.isArray(connections) ? connections.length > 0 : true
    })
    return hasConnection ? 'signed-in' : 'signed-out'
  } catch {
    return 'unknown'
  }
}

function parseNativeStatus(presetId: string, output: string): AuthStatus {
  if (presetId === 'cursor') return parseCursorAuthStatus(output)
  if (presetId === 'opencode') return parseOpenCodeAuthStatus(output)
  if (presetId === 'codex') {
    const text = stripVTControlCharacters(output)
    if (/^Not logged in$/m.test(text.trim())) return 'signed-out'
    if (/^Logged in using (?:ChatGPT|an API key(?: - .+)?)$/m.test(text.trim())) return 'signed-in'
    return 'unknown'
  }
  if (presetId === 'claude' || presetId === 'qoder') {
    const result = JSON.parse(output)?.[presetId === 'claude' ? 'loggedIn' : 'logged_in']
    if (typeof result === 'boolean') return result ? 'signed-in' : 'signed-out'
  }
  return 'unknown'
}

export async function getLocalAgentAuthStatus(config: LocalAgentConfiguration): Promise<AuthStatus> {
  if (localAgentChatProtocol(config) === 'cursor') {
    try {
      const { cursorAuthStatus } = await import('@cherrystudio/agent-runtime-cursor')
      return await cursorAuthStatus(config.env.CURSOR_API_KEY ?? (await getShellEnv()).CURSOR_API_KEY)
    } catch {
      return 'unknown'
    }
  }
  const preset = LOCAL_AGENT_PRESETS.find((entry) => matchesLocalAgentPreset(entry, config))
  if (!preset?.authStatusArgs) return 'unsupported'
  if (
    config.args.length &&
    (config.args.length !== preset.args.length || config.args.some((arg, i) => arg !== preset.args[i]))
  )
    return 'unsupported'
  try {
    const launch = await resolveLocalAgentLaunch(config)
    // Cursor's native status command checks OAuth, not an API key supplied through the environment.
    if (preset.id === 'cursor' && launch.env.CURSOR_API_KEY) return 'unsupported'
    return await executeCommand(launch.executable, [...preset.authStatusArgs], {
      env: launch.env,
      includeStderr: preset.id === 'codex',
      timeout: 10000,
      maxOutputBytes: 16384
    }).then(
      (output) => parseNativeStatus(preset.id, output),
      (error: unknown) => {
        if (error instanceof CommandFailedError && error.code === 1) {
          const output = preset.id === 'codex' ? [error.stdout, error.stderr].join('\n') : error.stdout
          if (parseNativeStatus(preset.id, output) === 'signed-out') return 'signed-out'
        }
        return 'unknown'
      }
    )
  } catch {
    return 'unknown'
  }
}
