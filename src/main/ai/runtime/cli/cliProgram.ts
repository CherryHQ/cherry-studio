import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { parse } from 'jsonc-parser'
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
import { getLocalAgentPreset, type LocalAgentConfiguration } from '@shared/ai/localAgent'
import type { CliConfigTarget } from '@shared/utils/cliConfig'

import { readModelProfile, type CliModelBinding, type CliModelProfile } from './cliModelProfile'
import { getClaudeSdkFallback, type InstalledBinary, selectAvailableInstallation } from './installedCli'
import { bindLaunchModel } from './launchBinding'
import { resolveRequiredRuntime } from './runtimeDependency'

type LaunchPurpose = 'session' | 'chat' | 'models' | 'account' | 'terminal-account' | 'cli'

type CliCommand = { executable: string; args: string[]; env: Record<string, string> }
export type PrepareCliCommand = (command: CliCommand) => Promise<CliCommand & { source: InstalledBinary['source'] }>

type CliLaunchPolicy = CliModelBinding & {
  componentId?: string
  defaultEnv?(): Record<string, string>
  hostBinary?: AcpHostBinary
  prepareCommand?: PrepareCliCommand
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
  return undefined
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

export async function requireLaunchRuntime(
  runtime: { executable: string; minimumVersion: string; label: string; major: string },
  env: Record<string, string>
) {
  const installed = await resolveRequiredRuntime(runtime, env)
  if (!installed) throw new Error(t('local_agent.runtime_required', { runtime: runtime.label, version: runtime.major }))
  const directories = [path.dirname(installed.path)]
  return {
    path: installed.path,
    source: installed.source,
    env: installed.source === 'mise' ? mergeBinaryExecutionEnv(env, directories) : mergePathPrefixes(env, directories)
  }
}

export async function resolveCliProgram(
  config: LocalAgentConfiguration,
  purpose: LaunchPurpose,
  signal?: AbortSignal,
  policy?: CliLaunchPolicy,
  /** `bindModel` hands the Agent's Cherry model to this launch; the caller owns `modelBinding.dispose`. */
  options: { sessionId?: string; bindModel?: boolean } = {}
) {
  const terminal = purpose === 'cli' || purpose === 'terminal-account'
  const definition = getLocalAgentPreset(config.presetId)
  if (definition?.protocol === 'cursor' || (config.presetId !== undefined && !definition))
    throw new Error('Invalid local agent preset')
  const preset =
    terminal && definition?.terminalCli
      ? { ...definition, executable: definition.terminalCli.executable, aliases: undefined }
      : definition
  if (config.presetId && application.get('LocalAgentInstallService').isUninstalling(config.presetId))
    throw new Error('Local agent is being uninstalled')
  let shellEnv = await getRawShellEnv(signal)
  let lookupEnv = mergeEnvironment(shellEnv, preset?.env, config.env)
  let installation: InstalledBinary | { source: 'none' } = { source: 'none' }
  const useTerminalOnPath = purpose === 'terminal-account' && getEnvironmentValue(config.env, 'PATH') !== undefined
  const useInstalledTerminal = terminal && (definition?.terminalCli || definition?.terminalUsesInstalledCli)
  const override = useTerminalOnPath ? preset?.executable : useInstalledTerminal ? undefined : config.executableOverride
  if (override) {
    const executable = path.isAbsolute(override)
      ? override
      : await findExecutableInEnv(override, { env: lookupEnv, signal })
    if (!executable) throw new Error('Local agent executable was not found')
    if (!(await fs.stat(executable)).isFile()) throw new Error('Local agent executable is not a file')
    await fs.access(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    const root = application.getPath('feature.binary.data')
    installation = {
      componentId: preset?.executable ?? policy?.componentId ?? override,
      path: executable,
      source: (await isManagedBinaryPath(executable, [root])) ? 'mise' : 'system'
    }
  } else if (preset) {
    const names = [preset.executable, ...(preset.aliases ?? [])]
    const snapshots = await application.get('BinaryManager').getToolSnapshots(names)
    installation = await selectAvailableInstallation(preset, snapshots)
    if (installation.source === 'none') installation = getClaudeSdkFallback(preset.executable) ?? installation
  }
  if (installation.source === 'none') {
    throw Object.assign(new Error('Local agent is not installed'), { code: 'LOCAL_AGENT_NOT_INSTALLED' })
  }
  if (config.presetId && application.get('LocalAgentInstallService').isUninstalling(config.presetId))
    throw new Error('Local agent is being uninstalled')
  const installed: InstalledBinary = installation
  const { path: executable, source } = installed
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
  const modelBinding = options.bindModel
    ? await bindLaunchModel(config, mergeEnvironment(env, preset?.env, config.env), {
        sessionId: options.sessionId,
        terminal,
        launchHook: (files, hookEnv) => injectPresetConfigEnv(policy?.profile, files, hookEnv, 'chat', lookupEnv)
      })
    : undefined
  try {
    return await finishCliProgram()
  } catch (error) {
    await modelBinding?.dispose()
    throw error
  }

  async function finishCliProgram() {
    const configFiles: LaunchConfigFiles = targets.size
      ? Object.fromEntries(
          (
            await application
              .get('CodeCliService')
              .readConfigFiles([...targets], scheduled ? mergeEnvironment(env, preset?.env, config.env) : undefined)
          ).map(({ target, content }) => [target, content])
        )
      : {}
    // A bound launch reads only the generated connection, never a stale one left in the user's files.
    const boundFiles = modelBinding?.files
    let nativeModel = injectPresetConfigEnv(
      profile,
      boundFiles ?? configFiles,
      env,
      purpose === 'models' ? 'models' : 'chat',
      lookupEnv
    )
    const boundProfileFile = profile && boundFiles?.[profile.target]
    if (!nativeModel && profile && boundProfileFile) nativeModel = readModelProfile(profile, boundProfileFile)
    let childEnv = mergeEnvironment(env, preset?.env, config.env)
    const windowsShell = definition?.windowsShell ?? policy?.windowsShell
    if (isWin && windowsShell && !getEnvironmentValue(childEnv, windowsShell.variable)) {
      const shell = await resolveWindowsShellPath(childEnv, windowsShell.allowSh)
      if (shell) childEnv[windowsShell.variable] = shell
    }
    // A bound launch takes its provider from the binding, not from the user's saved settings.
    if (scheduled && !modelBinding) {
      const content = configFiles[scheduled.target]
      childEnv = scheduled.merge(
        mergeEnvironment(env, preset?.env),
        parseJsonRecord(content),
        config.env,
        mergeEnvironment
      )
      if (content && policy?.profile) nativeModel = readModelProfile(policy.profile, content)
    }
    Object.assign(childEnv, modelBinding?.env)
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
      childEnv[binary.envKey] = available
    }
    const command = {
      executable,
      args: [
        ...(config.args.length ? config.args : (preset?.args ?? [])),
        ...(terminal ? [] : (modelBinding?.args ?? []))
      ],
      env: childEnv
    }
    const prepared = !terminal && !config.executableOverride ? await policy?.prepareCommand?.(command) : undefined
    const launch = prepared ?? command
    return {
      ...launch,
      installation: prepared ? undefined : installed,
      ...(nativeModel ? { nativeModel } : {}),
      source: prepared?.source ?? source,
      ...(modelBinding && { modelBinding })
    }
  }
}
