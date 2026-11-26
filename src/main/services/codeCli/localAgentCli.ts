import { application } from '@application'
import { resolveCliProgram, selectAvailableInstallation, selectChatInstallation } from '@main/ai/runtime/cli/cliProgram'
import { readInstalledPackageVersion } from '@main/ai/runtime/cli/installedVersion'
import { mergeEnvironment } from '@main/utils/env'
import {
  LOCAL_CLI_AGENT_PRESETS,
  type LocalAgentConfiguration,
  type LocalAgentDetection,
  localCliPresetById
} from '@shared/ai/localAgent'
import type { InputFor } from '@shared/ipc/types'

import { acpPreset } from '../../ai/runtime/acp/acpPresets'

export async function detectLocalAgents(): Promise<LocalAgentDetection[]> {
  const snapshots = await application
    .get('BinaryManager')
    .getToolSnapshots(
      LOCAL_CLI_AGENT_PRESETS.flatMap((preset) => [
        preset.executable,
        ...(preset.aliases ?? []),
        ...(preset.terminalCli ? [preset.terminalCli.executable] : [])
      ])
    )
  return Promise.all(
    LOCAL_CLI_AGENT_PRESETS.map(async (preset) => {
      const fallback = acpPreset(preset.id)?.cliFallback
      const installed = await selectChatInstallation(preset, snapshots, fallback)
      const terminal =
        preset.terminalCli && (installed.source === 'none' || installed.componentId !== preset.terminalCli.executable)
          ? await selectAvailableInstallation(preset.terminalCli, snapshots)
          : installed
      return {
        presetId: preset.id,
        source: installed.source,
        path: installed.source === 'none' ? undefined : installed.path,
        missingChatExecutable:
          preset.terminalCli?.requiredForChat && terminal.source === 'none' && installed.source !== 'none'
            ? preset.terminalCli.executable
            : undefined,
        terminalPath: preset.terminalArgs && terminal.source !== 'none' ? terminal.path : undefined,
        version:
          installed.source === 'none'
            ? undefined
            : 'version' in installed
              ? installed.version
              : await readInstalledPackageVersion(installed.path)
      }
    })
  )
}

export async function resolveLocalAgentCli(config: LocalAgentConfiguration, signal?: AbortSignal) {
  const { executable, source, env } = await resolveCliProgram(config, 'cli', signal, acpPreset(config.presetId))
  return { executable, source, env }
}

export async function openLocalAgentTerminal(config: InputFor<'ai.local_agents.open_terminal'>) {
  const preset = config.presetId ? localCliPresetById.get(config.presetId) : undefined
  if (!preset?.terminalArgs) throw new Error('This agent does not have a supported interactive CLI')
  let args = config.login ? preset.loginArgs : preset.terminalArgs
  if (!args) throw new Error('This agent does not have a supported terminal login command')
  if (typeof config.login === 'object') {
    if (!preset.providerLogin) throw new Error('This login method does not accept a provider')
    args = [...args, config.login.provider]
  } else if (config.login && preset.providerLogin) {
    throw new Error('Pi login requires a provider')
  }
  const launch = await resolveLocalAgentCli(config)
  const envKeys = new Set(['PATH', ...Object.keys(mergeEnvironment(preset.env, config.env))])
  const env = Object.fromEntries(
    Object.entries(launch.env).filter(
      ([key]) => envKeys.has(key) || key.toUpperCase() === 'PATH' || key.startsWith('MISE_')
    )
  )
  return application.get('CodeCliService').openTerminal({
    executable: launch.executable,
    args,
    env,
    usesCherryExecutionEnv: launch.source !== 'system',
    directory: config.directory,
    terminal: config.terminal
  })
}
