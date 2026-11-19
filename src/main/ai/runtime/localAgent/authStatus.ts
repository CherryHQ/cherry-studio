import { stripVTControlCharacters } from 'node:util'

import { executeCommand } from '@main/utils/processRunner'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'
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

export async function getLocalAgentAuthStatus(config: LocalAgentConfiguration): Promise<AuthStatus> {
  if (config.protocol !== 'acp' || config.presetId !== 'cursor') return 'unsupported'
  if (config.args.length && (config.args.length !== 1 || config.args[0] !== 'acp')) return 'unsupported'
  try {
    const launch = await resolveLocalAgentLaunch(config)
    // The native status command checks OAuth, not an API key supplied through the environment.
    if (launch.env.CURSOR_API_KEY) return 'unsupported'
    return parseCursorAuthStatus(
      await executeCommand(launch.executable, ['status'], {
        env: launch.env,
        timeout: 10000,
        maxOutputBytes: 16384
      })
    )
  } catch {
    return 'unknown'
  }
}
