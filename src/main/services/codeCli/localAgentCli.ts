import { application } from '@application'
import { resolveCliProgram } from '@main/ai/runtime/cli/cliProgram'
import { inspectAgentInstallation, selectAvailableInstallation } from '@main/ai/runtime/cli/installedCli'
import { readInstalledPackageVersion } from '@main/ai/runtime/cli/installedVersion'
import { mergeEnvironment } from '@main/utils/env'
import {
  getLocalAgentProtocol,
  LOCAL_CLI_AGENT_PRESETS,
  type LocalAgentConfiguration,
  type LocalAgentDetection,
  localCliPresetById
} from '@shared/ai/localAgent'
import type { InputFor } from '@shared/ipc/types'

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
      const { available, installed } = await inspectAgentInstallation(preset, snapshots)
      const terminal =
        preset.terminalCli && (available.source === 'none' || available.componentId !== preset.terminalCli.executable)
          ? await selectAvailableInstallation(preset.terminalCli, snapshots)
          : available
      return {
        presetId: preset.id,
        source: available.source,
        path: available.source === 'none' ? undefined : available.path,
        ...(available.source === 'none' && installed.source !== 'none' ? { incompatiblePath: installed.path } : {}),
        missingChatExecutable:
          preset.terminalCli?.requiredForChat && terminal.source === 'none' && available.source !== 'none'
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
  const policy =
    getLocalAgentProtocol(config.presetId) === 'acp'
      ? (await import('../../ai/runtime/acp/acpPresets')).acpPreset(config.presetId)
      : undefined
  const { executable, source, env } = await resolveCliProgram(config, 'cli', signal, policy)
  return { executable, source, env }
}

export async function openLocalAgentTerminal(config: InputFor<'ai.local_agents.open_terminal'>) {
  const preset = config.presetId ? localCliPresetById.get(config.presetId) : undefined
  if (!preset || (!config.login && !preset.terminalArgs))
    throw new Error('This agent does not have a supported interactive CLI')
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
