import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { parse } from 'jsonc-parser'
import { lt, valid } from 'semver'
import { parseDocument } from 'yaml'

import { application } from '@application'
import type { AcpHostBinary } from '@cherrystudio/agent-runtime-acp/profile'
import type { InstalledCli } from '@cherrystudio/agent-runtime/cli'
import { isWin } from '@main/core/platform'
import { t } from '@main/i18n'
import { appendBundledGitPathTail, mergeBinaryExecutionEnv, mergePathPrefixes } from '@main/utils/binaryEnv'
import { isManagedBinaryPath } from '@main/utils/binaryResolver'
import { getBundledGitDir } from '@main/utils/bundledGit'
import { autoDiscoverGitBash, findExecutableInEnv } from '@main/utils/commandResolver'
import { getEnvironmentValue, mergeEnvironment } from '@main/utils/env'
import { getRawShellEnv } from '@main/utils/shellEnv'
import { LOCAL_CLI_AGENT_PRESETS, type LocalCliAgentPreset, type LocalAgentConfiguration } from '@shared/ai/localAgent'
import type { BinaryAvailability, BinaryToolSnapshot } from '@shared/types/binary'
import type { CliConfigTarget } from '@shared/utils/cliConfig'

import { resolveCliGatewayRoute } from './cliGatewayRoute'
import { readModelProfile, type CliModelBinding, type CliModelProfile } from './cliModelProfile'
import { readInstalledPackageVersion } from './installedVersion'
import { resolveRequiredRuntime } from './runtimeDependency'

type AgentCommand = Pick<LocalCliAgentPreset, 'executable' | 'aliases'> &
  Partial<Pick<LocalCliAgentPreset, 'protocol' | 'minimumAcpVersion'>>

type InstalledBinary = InstalledCli<string, Exclude<BinaryAvailability['source'], 'none'>>
type LaunchPurpose = 'session' | 'chat' | 'models' | 'cli'

type CliLaunchPolicy = CliModelBinding & {
  componentId?: string
  cliFallback?: { executable: string; args: string[] }
  adapterEnv?(env: Record<string, string>, overrides: Record<string, string>): Record<string, string>
  defaultEnv?(): Record<string, string>
  hostBinary?: AcpHostBinary
  bundledBridge?: {
    runtime: { executable: string; minimumVersion: string; label: string; major: string }
    commandEnv: string
    entry(): string
  }
  windowsShell?: { variable: string; allowSh: boolean }
  scheduledEnvironment?: {
    target: CliConfigTarget
    merge(
      base: Record<string, string>,
      settings: Record<string, unknown> | undefined,
      overrides: Record<string, string>,
      merge: typeof mergeEnvironment
    ): Record<string, string>
  }
}
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

function parseJsonRecord(content: string | null | undefined): Record<string, unknown> | undefined {
  if (!content) return undefined
  const parsed = parse(content, [], { allowTrailingComma: true })
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined
}

function injectPresetConfigEnv(
  profile: CliModelProfile | undefined,
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

export function requireInstallation<Component extends string>(
  installation: InstalledBinary | undefined,
  componentId: Component
): InstalledCli<Component, InstalledBinary['source']> {
  if (installation?.componentId !== componentId) throw new Error(`Expected a ${componentId} installation`)
  return { ...installation, componentId }
}

export async function resolveCliProgram(
  config: LocalAgentConfiguration,
  purpose: LaunchPurpose,
  signal?: AbortSignal,
  policy?: CliLaunchPolicy
) {
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
  let nativeArgs: string[] | undefined
  if (config.executableOverride && !(terminal && (definition?.terminalCli || policy?.bundledBridge))) {
    const executable = path.isAbsolute(config.executableOverride)
      ? config.executableOverride
      : ((await findExecutableInEnv(config.executableOverride, { env: lookupEnv })) ?? undefined)
    if (!executable) throw new Error('Local agent executable was not found')
    if (!(await fs.stat(executable)).isFile()) throw new Error('Local agent executable is not a file')
    await fs.access(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    const root = application.getPath('feature.binary.data')
    installation = {
      componentId: preset?.executable ?? policy?.componentId ?? config.executableOverride,
      path: executable,
      source: (await isManagedBinaryPath(executable, [root])) ? 'mise' : 'system'
    }
  } else if (preset) {
    const names = [preset.executable, ...(preset.aliases ?? [])]
    const fallback = !terminal && !config.args.length ? policy?.cliFallback : undefined
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
    ...(policy?.hostBinary && !config.executableOverride ? [policy.hostBinary.executable] : [])
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
  Object.assign(env, policy?.defaultEnv?.())
  const scheduled = policy?.scheduledEnvironment
  let profile = terminal ? undefined : policy?.profile
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
  if (scheduled) targets.add(scheduled.target)
  const gatewaySelection =
    purpose === 'session' && config.sourceModelViaGateway && config.sourceModelId && config.nativeModel
      ? { sourceModelId: config.sourceModelId, nativeModel: config.nativeModel }
      : undefined
  const gatewayBinding =
    gatewaySelection && (policy?.gatewayOverlay || (policy?.gateway?.bindCredential && profile))
      ? { ...policy, profile }
      : undefined
  if (gatewayBinding?.gatewayOverlay) targets.add(gatewayBinding.gatewayOverlay.target)
  if (gatewayBinding?.gateway && profile) {
    const gateway = gatewayBinding.gateway
    targets.add(profile.target)
    if (gateway.target) targets.add(gateway.target)
    if (gateway.envFile) targets.add(gateway.envFile)
    if (gateway.related) targets.add(gateway.related.target)
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
  const gatewayRouteFor = (childEnv: Record<string, string>) =>
    gatewaySelection && gatewayBinding
      ? resolveCliGatewayRoute(gatewaySelection, gatewayBinding, configFiles, childEnv, shellEnv)
      : undefined
  const bridge = policy?.bundledBridge
  if (bridge && !terminal && !config.executableOverride) {
    const nativeExecutable = executable
    const finalEnv = mergeEnvironment(env, preset?.env, config.env)
    const runtime = await resolveRequiredRuntime(bridge.runtime, finalEnv)
    if (!runtime)
      throw new Error(
        t('local_agent.runtime_required', { runtime: bridge.runtime.label, version: bridge.runtime.major })
      )
    const childEnv = {
      ...(runtime.source === 'mise'
        ? mergeBinaryExecutionEnv(finalEnv, [path.dirname(runtime.path)])
        : mergePathPrefixes(finalEnv, [path.dirname(runtime.path)])),
      [bridge.commandEnv]: finalEnv[bridge.commandEnv] || nativeExecutable
    }
    return {
      executable: runtime.path,
      source: runtime.source,
      installation: undefined,
      gatewayRoute: gatewayRouteFor(childEnv),
      args: [bridge.entry(), ...config.args],
      env: childEnv
    }
  }
  let childEnv = mergeEnvironment(env, preset?.env, config.env)
  const windowsShell = definition?.windowsShell ?? policy?.windowsShell
  if (isWin && windowsShell && !getEnvironmentValue(childEnv, windowsShell.variable)) {
    const shell = await resolveWindowsShellPath(childEnv, windowsShell.allowSh)
    if (shell) childEnv[windowsShell.variable] = shell
  }
  if (scheduled) {
    const content = configFiles[scheduled.target]
    childEnv = scheduled.merge(
      mergeEnvironment(env, preset?.env),
      parseJsonRecord(content),
      config.env,
      mergeEnvironment
    )
    if (content && policy?.profile) nativeModel = readModelProfile(policy.profile, content)
  }
  if (policy?.adapterEnv && !terminal && !nativeArgs && !config.executableOverride)
    childEnv = policy.adapterEnv(childEnv, config.env)
  const binary = policy?.hostBinary
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
    gatewayRoute: gatewayRouteFor(childEnv),
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
