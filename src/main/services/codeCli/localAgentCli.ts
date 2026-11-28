import { application } from '@application'
import { resolveCliProgram } from '@main/ai/runtime/cli/cliProgram'
import {
  getClaudeSdkFallback,
  inspectAgentInstallation,
  selectAvailableInstallation
} from '@main/ai/runtime/cli/installedCli'
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
  const unresolved = (command: string) => !snapshots[command] || snapshots[command].application?.status === 'unknown'
  return Promise.all(
    LOCAL_CLI_AGENT_PRESETS.map(async (preset) => {
      const { available: detected, installed } = await inspectAgentInstallation(preset, snapshots)
      const available = detected.source === 'none' ? (getClaudeSdkFallback(preset.executable) ?? detected) : detected
      const terminal =
        preset.terminalCli && (available.source === 'none' || available.componentId !== preset.terminalCli.executable)
          ? await selectAvailableInstallation(preset.terminalCli, snapshots)
          : available
      const commands = [preset.executable, ...(preset.aliases ?? [])]
      const uncertain =
        commands.some((name) => snapshots[name]?.application?.status === 'unknown') ||
        (installed.source === 'none' && commands.some((name) => !snapshots[name])) ||
        (preset.terminalCli?.requiredForChat && terminal.source === 'none' && unresolved(preset.terminalCli.executable))
      return {
        presetId: preset.id,
        source: available.source,
        ...(uncertain && { uncertain: true as const }),
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

export async function resolveLocalAgentCli(config: LocalAgentConfiguration, signal?: AbortSignal, bindModel = false) {
  const policy =
    getLocalAgentProtocol(config.presetId) === 'acp'
      ? (await import('../../ai/runtime/acp/acpPresets')).acpPreset(config.presetId)
      : undefined
  const { executable, source, env, modelBinding } = await resolveCliProgram(config, 'cli', signal, policy, {
    bindModel
  })
  return { executable, source, env, ...(modelBinding && { modelBinding }) }
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
  const launch = await resolveLocalAgentCli(config, undefined, !config.login)
  const binding = launch.modelBinding
  const envKeys = new Set(['PATH', ...Object.keys(mergeEnvironment(preset.env, config.env, binding?.env))])
  const env = Object.fromEntries(
    Object.entries(launch.env).filter(
      ([key]) => envKeys.has(key) || key.toUpperCase() === 'PATH' || key.startsWith('MISE_')
    )
  )
  try {
    const result = await application.get('CodeCliService').openTerminal({
      executable: launch.executable,
      args: [...(binding?.args ?? []), ...args],
      env,
      usesCherryExecutionEnv: launch.source !== 'system',
      directory: config.directory,
      terminal: config.terminal
    })
    // Cherry cannot see the terminal exit, so its binding lives until Cherry stops.
    if (binding && result.success) application.get('LocalAgentOverlayService').retainUntilStop(binding)
    else await binding?.dispose()
    return result
  } catch (error) {
    await binding?.dispose()
    throw error
  }
}
