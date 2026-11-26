import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { parse } from 'jsonc-parser'
import { lt, valid } from 'semver'
import { parseDocument } from 'yaml'

import { application } from '@application'
import type { LocalClaudeLaunch } from '@cherrystudio/agent-runtime-claude-code'
import { claudeCli, scheduledClaudeEnvironment } from '@cherrystudio/agent-runtime-claude-code/cli'
import { codexCli } from '@cherrystudio/agent-runtime-codex/cli'
import type { CodexLaunch } from '@cherrystudio/agent-runtime-codex/launcher'
import type { InstalledCli } from '@cherrystudio/agent-runtime/cli'
import { isWin } from '@main/core/platform'
import { t } from '@main/i18n'
import { appendBundledGitPathTail, mergeBinaryExecutionEnv, mergePathPrefixes } from '@main/utils/binaryEnv'
import { isManagedBinaryPath } from '@main/utils/binaryResolver'
import { getBundledGitDir } from '@main/utils/bundledGit'
import { autoDiscoverGitBash, findExecutableInEnv } from '@main/utils/commandResolver'
import { getEnvironmentValue, mergeEnvironment } from '@main/utils/env'
import { getRawShellEnv } from '@main/utils/shellEnv'
import {
  LOCAL_CLI_AGENT_PRESETS,
  type LocalCliAgentPreset,
  type LocalAgentConfiguration,
  type LocalAgentDetection
} from '@shared/ai/localAgent'
import { LOCAL_AGENT_MODEL_CONFIG } from '@shared/ai/localAgentModel'
import type { InputFor } from '@shared/ipc/types'
import type { BinaryAvailability, BinaryToolSnapshot } from '@shared/types/binary'
import type { CliConfigTarget } from '@shared/utils/cliConfig'

import { acpPreset } from './acpPresets'
import { readInstalledPackageVersion } from './installedVersion'
import { readNativeModelConfig } from './nativeModelConfig'
import { resolveRequiredRuntime } from './runtimeDependency'

type AgentCommand = Pick<LocalCliAgentPreset, 'executable' | 'aliases'> &
  Partial<Pick<LocalCliAgentPreset, 'protocol' | 'minimumAcpVersion'>>

type InstalledBinary = InstalledCli<string, Exclude<BinaryAvailability['source'], 'none'>>
type LaunchPurpose = 'session' | 'chat' | 'scheduled-chat' | 'models' | 'cli'
export type LaunchConfigFiles = Readonly<Partial<Record<CliConfigTarget, string | null>>>

async function supportsAgentCommand(preset: AgentCommand, candidate: BinaryAvailability) {
  if (preset.protocol !== 'acp' || !preset.minimumAcpVersion || candidate.source === 'none') return true
  const version =
    valid('version' in candidate ? candidate.version : undefined) ?? (await readInstalledPackageVersion(candidate.path))
  return !version || !lt(version, preset.minimumAcpVersion)
}

async function selectInstallation(preset: AgentCommand, snapshots: Record<string, BinaryToolSnapshot>) {
  const candidates = await Promise.all(
    [preset.executable, ...(preset.aliases ?? [])].map(async (name) => {
      const candidate = snapshots[name]?.availability
      if (candidate && !(await supportsAgentCommand(preset, candidate))) return undefined
      return candidate
    })
  )
  return (
    candidates.find((value) => value?.source === 'system') ??
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
  preset: AgentCommand,
  snapshots: Record<string, BinaryToolSnapshot>
): Promise<InstalledBinary | { source: 'none' }> {
  const installed = await selectInstallation(preset, snapshots)
  const fallback = installed.source === 'none' ? installed : { ...installed, componentId: preset.executable }
  if (installed.source === 'system' || installed.source === 'bundled') return fallback
  const entry = systemAgentEntry(preset.executable)
  try {
    if (!(await fs.stat(entry)).isFile()) return fallback
    await fs.access(entry, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    if (
      await isManagedBinaryPath(entry, [
        application.getPath('feature.binary.data'),
        application.getPath('cherry.bin'),
        application.getPath('app.root')
      ])
    )
      return fallback
    const candidate = { source: 'system' as const, path: entry, componentId: preset.executable }
    return (await supportsAgentCommand(preset, candidate)) ? candidate : fallback
  } catch {
    return fallback
  }
}

export async function selectChatInstallation(
  preset: AgentCommand,
  snapshots: Record<string, BinaryToolSnapshot>,
  fallback?: AgentCommand,
  systemOnly = false
): Promise<InstalledBinary | { source: 'none' }> {
  const primary = await selectAvailableInstallation(preset, snapshots)
  if (primary.source !== 'none' && (!systemOnly || primary.source !== 'mise')) return primary
  if (fallback) {
    const alternate = await selectAvailableInstallation(fallback, snapshots)
    if (!systemOnly || alternate.source !== 'mise') return alternate
  }
  return { source: 'none' }
}

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

function parseJsonRecord(content: string | null | undefined): Record<string, unknown> | undefined {
  if (!content) return undefined
  const parsed = parse(content, [], { allowTrailingComma: true })
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined
}

function injectPresetConfigEnv(
  profile: NonNullable<ReturnType<typeof acpPreset>>['profile'],
  files: LaunchConfigFiles,
  env: Record<string, string>,
  purpose: 'chat' | 'models',
  lookupEnv: NodeJS.ProcessEnv
): string | undefined {
  if (profile?.format === 'json' && profile.launch) {
    const get = (key: string) => getEnvironmentValue(lookupEnv, key)
    const primary = parseJsonRecord(files[profile.target]) ?? {}
    const related = profile.relatedTarget ? parseJsonRecord(files[profile.relatedTarget]) : undefined
    return profile.launch(primary, env, get, related, purpose)
  }
  if (profile?.format === 'yaml' && profile.launch) {
    const content = files[profile.target]
    if (content == null) return
    return profile.launch(parseDocument(content), env, purpose, () => {
      throw new Error(t('code_cli.model.invalid_config', { format: 'YAML' }))
    })
  }
}

async function isExistingFile(filePath: string): Promise<boolean> {
  return (await fs.stat(filePath).catch(() => undefined))?.isFile() ?? false
}

async function resolveWindowsShellPath(
  childEnv: Record<string, string>,
  allowMinGitSh: boolean
): Promise<string | undefined> {
  const discovered = autoDiscoverGitBash()
  if (discovered) return discovered
  if (!allowMinGitSh) return undefined
  // MinGit ships GNU bash as usr/bin/sh.exe without bin/bash.exe; Kimi accepts it via KIMI_SHELL_PATH.
  const bundledGitDir = getBundledGitDir()
  const gitCandidates = [
    await findExecutableInEnv('git', childEnv),
    bundledGitDir ? path.join(bundledGitDir, 'git.exe') : null
  ].filter((candidate): candidate is string => Boolean(candidate))
  for (const gitExe of gitCandidates) {
    const shPath = path.resolve(gitExe, '..', '..', 'usr', 'bin', 'sh.exe')
    if (await isExistingFile(shPath)) return shPath
  }
  return undefined
}

export function resolveLocalAgentLaunch(
  config: LocalAgentConfiguration,
  signal?: AbortSignal,
  purpose: 'chat' | 'session' = 'chat'
) {
  return resolveProgram(config, purpose, signal)
}

export function resolveLocalAgentModelLaunch(config: LocalAgentConfiguration, signal?: AbortSignal) {
  return resolveProgram(config, 'models', signal)
}

export async function resolveCodexLaunch(
  config: LocalAgentConfiguration,
  cwd: string,
  signal: AbortSignal,
  purpose: 'chat' | 'models' = 'chat'
): Promise<CodexLaunch & { configFiles: LaunchConfigFiles }> {
  const program = await resolveProgram(config, purpose === 'chat' ? 'session' : purpose, signal)
  return {
    installation: requireInstallation(program.installation, codexCli.executable),
    cwd,
    env: program.env,
    args: program.args,
    configFiles: program.configFiles,
    executableOverride: config.executableOverride !== undefined
  }
}

export async function resolveClaudeLaunch(
  config: LocalAgentConfiguration,
  cwd: string,
  signal: AbortSignal,
  purpose: 'chat' | 'scheduled-chat' | 'models'
): Promise<LocalClaudeLaunch & { env: Record<string, string>; nativeModel?: string; configFiles: LaunchConfigFiles }> {
  const program = await resolveProgram(config, purpose === 'chat' ? 'session' : purpose, signal)
  return {
    installation: requireInstallation(program.installation, claudeCli.executable),
    cwd,
    env: program.env,
    args: program.args,
    configFiles: program.configFiles,
    nativeModel: program.nativeModel
  }
}

function requireInstallation<Component extends string>(
  installation: InstalledBinary | undefined,
  componentId: Component
): InstalledCli<Component, InstalledBinary['source']> {
  if (installation?.componentId !== componentId) throw new Error(`Expected a ${componentId} installation`)
  return { ...installation, componentId }
}

export async function resolveLocalAgentCli(config: LocalAgentConfiguration, signal?: AbortSignal) {
  const { executable, source, env } = await resolveProgram(config, 'cli', signal)
  return { executable, source, env }
}

async function resolveProgram(config: LocalAgentConfiguration, purpose: LaunchPurpose, signal?: AbortSignal) {
  const terminal = purpose === 'cli'
  const definition = LOCAL_CLI_AGENT_PRESETS.find((p) => p.id === config.presetId)
  const preset =
    terminal && definition?.terminalCli
      ? { ...definition, executable: definition.terminalCli.executable, aliases: undefined }
      : definition
  if (config.protocol === 'cursor' || (config.presetId && (!preset || preset.protocol !== config.protocol)))
    throw new Error('Invalid local agent preset')
  if (config.presetId && application.get('LocalAgentInstallService').isUninstalling(config.presetId))
    throw new Error('Local agent is being uninstalled')
  let shellEnv = await getRawShellEnv(signal)
  let lookupEnv = mergeEnvironment(shellEnv, preset?.env, config.env)
  let installation: InstalledBinary | { source: 'none' } = { source: 'none' }
  const desktop = acpPreset(config.presetId)
  let nativeArgs: string[] | undefined
  if (config.executableOverride && !(terminal && (definition?.terminalCli || desktop?.bundledBridge))) {
    const executable = path.isAbsolute(config.executableOverride)
      ? config.executableOverride
      : ((await findExecutableInEnv(config.executableOverride, { env: lookupEnv })) ?? undefined)
    if (!executable) throw new Error('Local agent executable was not found')
    if (!(await fs.stat(executable)).isFile()) throw new Error('Local agent executable is not a file')
    await fs.access(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    const root = application.getPath('feature.binary.data')
    installation = {
      componentId:
        preset?.executable ??
        (config.protocol === 'codex'
          ? codexCli.executable
          : config.protocol === 'claude'
            ? claudeCli.executable
            : config.executableOverride),
      path: executable,
      source: (await isManagedBinaryPath(executable, [root])) ? 'mise' : 'system'
    }
  } else if (preset) {
    const names = [preset.executable, ...(preset.aliases ?? [])]
    const fallback = !terminal && !config.args.length ? desktop?.cliFallback : undefined
    if (fallback) names.push(fallback.executable)
    const snapshots = await application.get('BinaryManager').getToolSnapshots(names)
    installation = await selectChatInstallation(preset, snapshots, fallback)
    if (fallback && installation.source !== 'none' && installation.componentId === fallback.executable)
      nativeArgs = fallback.args
  }
  if (installation.source === 'none') {
    throw Object.assign(new Error('Local agent is not installed'), { code: 'LOCAL_AGENT_NOT_INSTALLED' })
  }
  if (config.presetId && application.get('LocalAgentInstallService').isUninstalling(config.presetId))
    throw new Error('Local agent is being uninstalled')
  const { path: executable, source } = installation
  const dependencies = [
    ...(!terminal && definition?.terminalCli ? [definition.terminalCli.executable] : []),
    ...(desktop?.hostBinary && !config.executableOverride ? [desktop.hostBinary.executable] : [])
  ]
  const dependencySnapshots = dependencies.length
    ? await application.get('BinaryManager').getToolSnapshots(dependencies)
    : {}
  // Discovery can promote the shared snapshot to the interactive shell environment.
  shellEnv = await getRawShellEnv(signal)
  lookupEnv = mergeEnvironment(shellEnv, preset?.env, config.env)
  let env =
    source === 'system' ? { ...shellEnv } : mergeBinaryExecutionEnv(shellEnv, [application.getPath('cherry.bin')])
  for (const name of dependencies) {
    const dependency = await selectAvailableInstallation({ executable: name }, dependencySnapshots)
    const required =
      !config.executableOverride &&
      definition?.terminalCli?.requiredForChat &&
      definition.terminalCli.executable === name
    if (
      required &&
      (dependency.source === 'none' || getEnvironmentValue(config.env, 'PATH') !== undefined) &&
      !(await findExecutableInEnv(name, { env: lookupEnv }))
    ) {
      throw Object.assign(new Error(t('local_agent.host_required', { agent: definition.name, host: name })), {
        code: 'LOCAL_AGENT_HOST_REQUIRED'
      })
    }
    if (dependency.source !== 'none') {
      const directories = [path.dirname(dependency.path)]
      env =
        dependency.source === 'mise' ? mergeBinaryExecutionEnv(env, directories) : mergePathPrefixes(env, directories)
    }
  }
  if (definition?.requiredRuntime) {
    const runtime = await resolveRequiredRuntime(definition.requiredRuntime, lookupEnv)
    if (runtime)
      env =
        runtime.source === 'mise'
          ? mergeBinaryExecutionEnv(env, [path.dirname(runtime.path)])
          : mergePathPrefixes(env, [path.dirname(runtime.path)])
  }
  appendBundledGitPathTail(env)
  Object.assign(env, desktop?.defaultEnv?.())
  const native = config.protocol === 'claude' ? claudeCli : undefined
  const scheduled = purpose === 'scheduled-chat' ? native : undefined
  let profile = terminal ? undefined : desktop?.profile
  if (
    profile?.format === 'json' &&
    profile.matchesEnvironment &&
    !profile.matchesEnvironment(
      (key) => getEnvironmentValue(lookupEnv, key),
      (key) => getEnvironmentValue(shellEnv, key)
    )
  )
    profile = undefined

  const targets = new Set<CliConfigTarget>()
  if (profile?.format === 'json' && profile.launch) {
    targets.add(profile.target)
    if (profile.relatedTarget) targets.add(profile.relatedTarget)
  }
  if (profile?.format === 'yaml' && profile.launch) targets.add(profile.target)
  if (scheduled) targets.add(scheduled.modelConfig.target)
  if (
    (purpose === 'session' || scheduled) &&
    config.sourceModelViaGateway &&
    config.sourceModelId &&
    config.nativeModel &&
    config.presetId
  ) {
    const binding = LOCAL_AGENT_MODEL_CONFIG[config.presetId]
    const gateway = desktop?.gateway
    const overlay = desktop?.gatewayOverlay
    if (overlay) targets.add(overlay.target)
    if (binding && gateway && profile) {
      targets.add(binding.target)
      if (gateway.target) targets.add(gateway.target)
      if (gateway.envFile) targets.add(gateway.envFile)
      if (gateway.related) targets.add(gateway.related.target)
    }
  }
  const configFiles: LaunchConfigFiles = targets.size
    ? Object.fromEntries(
        (
          await application
            .get('CodeCliService')
            .readConfigFiles([...targets], scheduled ? mergeEnvironment(env, preset?.env, config.env) : undefined)
        ).map(({ target, content }) => [target, content])
      )
    : {}
  let nativeModel = injectPresetConfigEnv(
    profile,
    configFiles,
    env,
    purpose === 'models' ? 'models' : 'chat',
    lookupEnv
  )
  const bridge = desktop?.bundledBridge
  if (bridge && !terminal && !config.executableOverride) {
    const nativeExecutable = executable
    const finalEnv = mergeEnvironment(env, preset?.env, config.env)
    const runtime = await resolveRequiredRuntime(bridge.runtime, finalEnv)
    if (!runtime)
      throw new Error(
        t('local_agent.runtime_required', { runtime: bridge.runtime.label, version: bridge.runtime.major })
      )
    return {
      executable: runtime.path,
      source: runtime.source,
      installation: undefined,
      configFiles,
      args: [bridge.entry(), ...config.args],
      env: {
        ...(runtime.source === 'mise'
          ? mergeBinaryExecutionEnv(finalEnv, [path.dirname(runtime.path)])
          : mergePathPrefixes(finalEnv, [path.dirname(runtime.path)])),
        [bridge.commandEnv]: finalEnv[bridge.commandEnv] || nativeExecutable
      }
    }
  }
  let childEnv = mergeEnvironment(env, preset?.env, config.env)
  const windowsShell = definition?.windowsShell ?? native?.windowsShell
  if (isWin && windowsShell && !getEnvironmentValue(childEnv, windowsShell.variable)) {
    const shell = await resolveWindowsShellPath(childEnv, windowsShell.allowSh)
    if (shell) childEnv[windowsShell.variable] = shell
  }
  if (scheduled) {
    const content = configFiles[scheduled.modelConfig.target]
    childEnv = scheduledClaudeEnvironment(
      mergeEnvironment(env, preset?.env),
      parseJsonRecord(content),
      config.env,
      mergeEnvironment
    )
    if (content) nativeModel = readNativeModelConfig(scheduled.modelConfig.target, content)
  }
  if (desktop?.adapterEnv && !terminal && !nativeArgs && !config.executableOverride)
    childEnv = desktop.adapterEnv(childEnv, config.env)
  const binary = desktop?.hostBinary
  if (binary && !config.executableOverride) {
    const available = await binary.resolve(childEnv, {
      windows: isWin,
      home: () => application.getPath('sys.home'),
      find: (name) => findExecutableInEnv(name, { env: childEnv }),
      installed: async () => {
        const installed = await selectAvailableInstallation(binary, dependencySnapshots)
        return installed.source !== 'none' ? installed.path : undefined
      },
      isFile: isExistingFile
    })
    if (!available)
      throw Object.assign(
        new Error(
          t('local_agent.host_required_with_env', {
            agent: definition?.name ?? binary.executable,
            host: binary.label,
            envVar: binary.envKey
          })
        ),
        { code: 'LOCAL_AGENT_HOST_REQUIRED' }
      )
  }
  return {
    executable,
    installation,
    configFiles,
    ...(nativeModel ? { nativeModel } : {}),
    source,
    args:
      nativeArgs ??
      (config.args.length
        ? config.args
        : [...(preset?.platformArgs?.[process.platform as 'linux' | 'darwin' | 'win32'] ?? preset?.args ?? [])]),
    env: childEnv
  }
}

export async function openLocalAgentTerminal(config: InputFor<'ai.local_agents.open_terminal'>) {
  const preset = LOCAL_CLI_AGENT_PRESETS.find((entry) => entry.id === config.presetId)
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
