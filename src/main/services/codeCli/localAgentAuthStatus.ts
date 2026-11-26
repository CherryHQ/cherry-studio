import { stripVTControlCharacters } from 'node:util'

import type { RuntimeAccountResult } from '@cherrystudio/agent-runtime'
import { CommandFailedError, executeCommand } from '@main/utils/processRunner'
import { getLocalAgentPreset, type LocalAgentConfiguration } from '@shared/ai/localAgent'

import { resolveLocalAgentCli } from './localAgentCli'

export async function readCliAccount(
  config: LocalAgentConfiguration,
  signal?: AbortSignal
): Promise<RuntimeAccountResult> {
  const preset = getLocalAgentPreset(config.presetId)
  const probe = preset?.accountProbe
  if (!preset || !probe) return { status: 'unsupported' }
  if (
    config.args.length &&
    (config.args.length !== preset.args.length || config.args.some((arg, i) => arg !== preset.args[i]))
  )
    return { status: 'unsupported' }
  try {
    const launch = await resolveLocalAgentCli(config, signal)
    return await executeCommand(launch.executable, [...probe.args], {
      env: launch.env,
      timeout: 10000,
      maxOutputBytes: 16384,
      ...(probe.stdin !== undefined && { stdin: probe.stdin })
    }).then(
      (output) => probe.parse(stripVTControlCharacters(output), launch.env),
      (error: unknown) => {
        if (error instanceof CommandFailedError && error.code === probe.signedOutExitCode) {
          const result = probe.parse(stripVTControlCharacters(error.stdout), launch.env)
          if (result.status === 'signed-out') return result
          const diagnostics = probe.parse(stripVTControlCharacters(error.stderr), launch.env)
          if (diagnostics.status === 'signed-out') return diagnostics
        }
        return { status: 'unknown' }
      }
    )
  } catch {
    return { status: 'unknown' }
  }
}
