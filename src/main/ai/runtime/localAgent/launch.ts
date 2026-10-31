import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { parseDocument } from 'yaml'

import { application } from '@application'
import { t } from '@main/i18n'
import { appendBundledGitPathTail, mergeBinaryExecutionEnv } from '@main/utils/binaryEnv'
import { findExecutableInEnv } from '@main/utils/commandResolver'
import { mergeEnvironment } from '@main/utils/env'
import { isOutsidePath } from '@main/utils/file'
import { getRawShellEnv } from '@main/utils/shellEnv'
import {
  LOCAL_AGENT_PRESETS,
  type LocalAgentPreset,
  type LocalAgentConfiguration,
  type LocalAgentDetection
} from '@shared/ai/localAgent'
import type { InputFor } from '@shared/ipc/types'
import type { BinaryToolSnapshot } from '@shared/types/binary'
import { POOLSIDE_GATEWAY_SERVER } from '@shared/utils/cliConfig'

import { readInstalledPackageVersion } from './installedVersion'

function selectInstallation(
  preset: Pick<LocalAgentPreset, 'executable' | 'aliases'>,
  snapshots: Record<string, BinaryToolSnapshot>
) {
  const candidates = [preset.executable, ...(preset.aliases ?? [])].map((name) => snapshots[name]?.availability)
  return (
    candidates.find((value) => value?.source === 'mise') ??
    candidates.find((value) => value && value.source !== 'none') ?? { source: 'none' as const }
  )
}

export function systemAgentEntry(executable: string): string {
  return application.getPath('external.acp.bin', `${executable}${process.platform === 'win32' ? '.cmd' : ''}`)
}

export function systemAgentWrapper(command: string): string {
  return process.platform === 'win32'
    ? `@echo off\r\n"${command.replace(/%/g, '%%')}" %*\r\n`
    : `#!/bin/sh\nexec '${command.replace(/'/g, "'\\''")}' "$@"\n`
}

export async function selectAvailableInstallation(
  preset: Pick<LocalAgentPreset, 'executable' | 'aliases'>,
  snapshots: Record<string, BinaryToolSnapshot>
) {
  const installed = selectInstallation(preset, snapshots)
  if (installed.source !== 'none') return installed
  const entry = systemAgentEntry(preset.executable)
  try {
    if (!(await fs.stat(entry)).isFile()) return installed
    await fs.access(entry, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return { source: 'system' as const, path: entry }
  } catch {
    return installed
  }
}

export async function detectLocalAgents(): Promise<LocalAgentDetection[]> {
  const snapshots = await application
    .get('BinaryManager')
    .getToolSnapshots(
      LOCAL_AGENT_PRESETS.flatMap((preset) => [
        preset.executable,
        ...(preset.aliases ?? []),
        ...(preset.terminalExecutable ? [preset.terminalExecutable] : [])
      ])
    )
  return Promise.all(
    LOCAL_AGENT_PRESETS.map(async (preset) => {
      const installed = await selectAvailableInstallation(preset, snapshots)
      const terminal = preset.terminalExecutable
        ? await selectAvailableInstallation({ executable: preset.terminalExecutable }, snapshots)
        : installed
      return {
        presetId: preset.id,
        ...installed,
        terminalPath: preset.terminalArgs && terminal.source !== 'none' ? terminal.path : undefined,
        version:
          'version' in installed
            ? installed.version
            : installed.source !== 'none'
              ? await readInstalledPackageVersion(installed.path)
              : undefined
      }
    })
  )
}

export async function resolveLocalAgentLaunch(
  config: LocalAgentConfiguration,
  signal?: AbortSignal,
  mode: boolean | 'models' = false
) {
  const terminal = mode === true
  const definition = LOCAL_AGENT_PRESETS.find((p) => p.id === config.presetId)
  const preset =
    terminal && definition?.terminalExecutable
      ? { ...definition, executable: definition.terminalExecutable, aliases: undefined }
      : definition
  if (config.presetId && (!preset || preset.protocol !== config.protocol)) throw new Error('Invalid local agent preset')
  if (config.presetId && application.get('LocalAgentInstallService').isUninstalling(config.presetId))
    throw new Error('Local agent is being uninstalled')
  const shellEnv = await getRawShellEnv(signal)
  const lookupEnv = mergeEnvironment(shellEnv, preset?.env, config.env)
  let executable: string | undefined
  let source = 'system'
  if (config.executableOverride && !(terminal && definition?.terminalExecutable)) {
    executable = path.isAbsolute(config.executableOverride)
      ? config.executableOverride
      : ((await findExecutableInEnv(config.executableOverride, { env: lookupEnv })) ?? undefined)
    if (!executable) throw new Error('Local agent executable was not found')
    if (!(await fs.stat(executable)).isFile()) throw new Error('Local agent executable is not a file')
    await fs.access(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    const root = application.getPath('feature.binary.data')
    if (!isOutsidePath(path.relative(root, executable))) source = 'mise'
  } else if (preset) {
    const snapshots = await application
      .get('BinaryManager')
      .getToolSnapshots([preset.executable, ...(preset.aliases ?? [])])
    const installation = await selectAvailableInstallation(preset, snapshots)
    executable = installation.source !== 'none' ? installation.path : undefined
    source = installation.source
  }
  if (!executable) {
    throw Object.assign(new Error('Local agent is not installed'), { code: 'LOCAL_AGENT_NOT_INSTALLED' })
  }
  if (config.presetId && application.get('LocalAgentInstallService').isUninstalling(config.presetId))
    throw new Error('Local agent is being uninstalled')
  const env =
    source === 'system' ? { ...shellEnv } : mergeBinaryExecutionEnv(shellEnv, [application.getPath('cherry.bin')])
  appendBundledGitPathTail(env)
  let nativeModel: string | undefined
  if (config.presetId === 'poolside' && !terminal) {
    const [file] = await application.get('CodeCliService').readConfigFiles(['poolside-settings'])
    if (file.content !== null) {
      const document = parseDocument(file.content)
      if (document.errors.length) throw new Error(t('code_cli.model.invalid_config', { format: 'YAML' }))
      const server =
        mode !== 'models' && document.getIn(['pool', 'default_agent_server']) === POOLSIDE_GATEWAY_SERVER
          ? POOLSIDE_GATEWAY_SERVER
          : 'Poolside'
      const model = document.getIn(['agent_servers', server, 'default_config_options', 'model'])
      if (typeof model === 'string') nativeModel = model
      if (server === POOLSIDE_GATEWAY_SERVER) {
        for (const key of ['POOLSIDE_API_KEY', 'POOLSIDE_STANDALONE_BASE_URL', 'POOLSIDE_STANDALONE_MODEL']) {
          const value = document.getIn(['agent_servers', POOLSIDE_GATEWAY_SERVER, 'env', key])
          if (typeof value !== 'string' || !value)
            throw new Error(t('code_cli.model.invalid_config', { format: 'YAML' }))
          env[key] = value
        }
      }
    }
  }
  return {
    executable,
    ...(nativeModel ? { nativeModel } : {}),
    source,
    args: config.args.length
      ? config.args
      : [...(preset?.platformArgs?.[process.platform as 'linux' | 'darwin' | 'win32'] ?? preset?.args ?? [])],
    env: mergeEnvironment(env, preset?.env, config.env)
  }
}

export async function openLocalAgentTerminal(config: InputFor<'ai.local_agents.open_terminal'>) {
  const preset = LOCAL_AGENT_PRESETS.find((entry) => entry.id === config.presetId)
  if (!preset?.terminalArgs) throw new Error('This agent does not have a supported interactive CLI')
  const args = config.login ? preset.loginArgs : preset.terminalArgs
  if (!args) throw new Error('This agent does not have a supported terminal login command')
  const launch = await resolveLocalAgentLaunch(config, undefined, true)
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
