import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { parse } from 'jsonc-parser'
import { lt, valid } from 'semver'
import { parseDocument } from 'yaml'

import { application } from '@application'
import { t } from '@main/i18n'
import { CHERRY_NODE_PROXY_RULES_ENV, getProxyEnvironment } from '@main/services/proxy/proxyEnv'
import { appendBundledGitPathTail, mergeBinaryExecutionEnv, mergePathPrefixes } from '@main/utils/binaryEnv'
import { isManagedBinaryPath } from '@main/utils/binaryResolver'
import { findExecutableInEnv } from '@main/utils/commandResolver'
import { mergeEnvironment } from '@main/utils/env'
import { getRawShellEnv } from '@main/utils/shellEnv'
import {
  LOCAL_AGENT_PRESETS,
  type LocalAgentPreset,
  type LocalAgentConfiguration,
  type LocalAgentDetection
} from '@shared/ai/localAgent'
import type { InputFor } from '@shared/ipc/types'
import type { BinaryAvailability, BinaryToolSnapshot } from '@shared/types/binary'
import { POOLSIDE_GATEWAY_SERVER } from '@shared/utils/cliConfig'

import { readInstalledPackageVersion, resolveInstalledExecutable } from './installedVersion'
import { resolveRequiredRuntime } from './runtimeDependency'

type AgentCommand = Pick<LocalAgentPreset, 'executable' | 'aliases'> & Partial<Pick<LocalAgentPreset, 'protocol'>>

async function supportsAgentCommand(preset: AgentCommand, candidate: BinaryAvailability) {
  if (preset.executable !== 'dsh' || preset.protocol !== 'acp' || candidate.source === 'none') return true
  const version =
    valid('version' in candidate ? candidate.version : undefined) ?? (await readInstalledPackageVersion(candidate.path))
  // This is the first dsh package that includes the ACP profile.
  return !version || !lt(version, '0.1.2-alpha.2')
}

async function selectInstallation(preset: AgentCommand, snapshots: Record<string, BinaryToolSnapshot>) {
  const candidates = await Promise.all(
    [preset.executable, ...(preset.aliases ?? [])].map(async (name) => {
      const candidate = snapshots[name]?.availability
      if (candidate && !(await supportsAgentCommand(preset, candidate))) return undefined
      if (preset.executable === 'cursor-agent' && name === 'agent' && candidate && candidate.source !== 'none') {
        const target = await resolveInstalledExecutable(candidate.path).catch(() => '')
        if (!/^cursor-agent(?:\.exe|\.cmd)?$/i.test(path.basename(target))) return undefined
      }
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

export async function selectAvailableInstallation(preset: AgentCommand, snapshots: Record<string, BinaryToolSnapshot>) {
  const installed = await selectInstallation(preset, snapshots)
  if (installed.source === 'system' || installed.source === 'bundled') return installed
  const entry = systemAgentEntry(preset.executable)
  try {
    if (!(await fs.stat(entry)).isFile()) return installed
    await fs.access(entry, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    if (
      await isManagedBinaryPath(entry, [
        application.getPath('feature.binary.data'),
        application.getPath('cherry.bin'),
        application.getPath('app.root')
      ])
    )
      return installed
    const candidate = { source: 'system' as const, path: entry }
    return (await supportsAgentCommand(preset, candidate)) ? candidate : installed
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
      const adapter = await selectAvailableInstallation(preset, snapshots)
      const terminal = preset.terminalExecutable
        ? await selectAvailableInstallation({ executable: preset.terminalExecutable }, snapshots)
        : adapter
      const installed = preset.id === 'antigravity-acp' && adapter.source === 'none' ? terminal : adapter
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

function parseJsonRecord(content: string | null | undefined): Record<string, unknown> | undefined {
  if (!content) return undefined
  const parsed = parse(content, [], { allowTrailingComma: true })
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined
}

async function readCliConfigFilesSafe(
  targets: Parameters<ReturnType<typeof application.get<'CodeCliService'>>['readConfigFiles']>[0]
) {
  const result = await application.get('CodeCliService').readConfigFiles(targets)
  return Array.isArray(result) ? result : []
}

async function injectPresetConfigEnv(
  presetId: string | undefined,
  env: Record<string, string>,
  mode: boolean | 'models'
): Promise<string | undefined> {
  let nativeModel: string | undefined
  if (presetId === 'poolside') {
    const [file] = await readCliConfigFilesSafe(['poolside-settings'])
    if (file?.content != null) {
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
    return nativeModel
  }

  if (presetId === 'glm-acp-agent') {
    const [file] = await readCliConfigFilesSafe(['glm-credentials'])
    const doc = parseJsonRecord(file?.content)
    if (!doc) return undefined
    let apiKey: string | undefined
    let baseUrl: string | undefined
    let model: string | undefined
    if (doc.cherry_managed === true) {
      apiKey = typeof doc.z_ai_api_key === 'string' ? doc.z_ai_api_key : undefined
      baseUrl = typeof doc.base_url === 'string' ? doc.base_url : undefined
      model = typeof doc.model === 'string' ? doc.model : undefined
    } else if (doc.providers && typeof doc.providers === 'object' && !Array.isArray(doc.providers)) {
      const cherryKey =
        typeof doc.provider === 'string' && doc.provider.startsWith('cherry-') ? doc.provider : undefined
      const entry = cherryKey ? (doc.providers as Record<string, unknown>)[cherryKey] : undefined
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const record = entry as Record<string, unknown>
        apiKey = typeof record.apiKey === 'string' ? record.apiKey : undefined
        baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl : undefined
        model = typeof record.model === 'string' ? record.model : undefined
      }
    }
    if (apiKey) env.Z_AI_API_KEY = apiKey
    if (baseUrl) env.ACP_GLM_BASE_URL = baseUrl
    if (model) {
      env.ACP_GLM_MODEL = model
      if (mode !== 'models') env.ACP_GLM_AVAILABLE_MODELS = model
      nativeModel = model
    }
    return nativeModel
  }

  if (presetId === 'codebuddy-code') {
    const files = await readCliConfigFilesSafe(['codebuddy-settings', 'codebuddy-models'])
    const settings = parseJsonRecord(files.find((file) => file.target === 'codebuddy-settings')?.content)
    const modelsDoc = parseJsonRecord(files.find((file) => file.target === 'codebuddy-models')?.content)
    const list = Array.isArray(modelsDoc?.models) ? modelsDoc.models : []
    const activeId = typeof settings?.model === 'string' ? settings.model : undefined
    const entry = list.find((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false
      const record = item as Record<string, unknown>
      return record['x-cherry-studio'] === true && (!activeId || record.id === activeId)
    }) as Record<string, unknown> | undefined
    if (typeof entry?.apiKey === 'string' && entry.apiKey) {
      env.CODEBUDDY_API_KEY = entry.apiKey
    }
    if (activeId) nativeModel = activeId
    return nativeModel
  }

  if (presetId === 'cline') {
    const [file] = await readCliConfigFilesSafe(['cline-providers'])
    const doc = parseJsonRecord(file?.content)
    const providers =
      doc?.providers && typeof doc.providers === 'object' && !Array.isArray(doc.providers)
        ? (doc.providers as Record<string, unknown>)
        : undefined
    const entry = providers?.['openai-compatible']
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined
    const record = entry as Record<string, unknown>
    if (record.cherryManaged !== true) return undefined
    const settings =
      record.settings && typeof record.settings === 'object' && !Array.isArray(record.settings)
        ? (record.settings as Record<string, unknown>)
        : undefined
    if (typeof settings?.apiKey === 'string' && settings.apiKey) env.CLINE_API_KEY = settings.apiKey
    env.CLINE_PROVIDER =
      typeof settings?.provider === 'string' && settings.provider ? settings.provider : 'openai-compatible'
    if (typeof settings?.baseUrl === 'string' && settings.baseUrl) {
      env.OPENAI_BASE_URL = settings.baseUrl
      env.CLINE_BASE_URL = settings.baseUrl
    }
    if (typeof settings?.model === 'string' && settings.model) {
      env.CLINE_MODEL = settings.model
      nativeModel = settings.model
    }
    return nativeModel
  }

  if (presetId === 'snow') {
    const [file] = await readCliConfigFilesSafe(['snow-config'])
    const doc = parseJsonRecord(file?.content)
    const snowcfg =
      doc?.snowcfg && typeof doc.snowcfg === 'object' && !Array.isArray(doc.snowcfg)
        ? (doc.snowcfg as Record<string, unknown>)
        : undefined
    return doc?.cherryManaged === true && typeof snowcfg?.advancedModel === 'string' && snowcfg.advancedModel
      ? snowcfg.advancedModel
      : undefined
  }

  if (presetId === 'goose') {
    const [file] = await readCliConfigFilesSafe(['goose-config'])
    if (file?.content != null) {
      const document = parseDocument(file.content)
      if (!document.errors.length && document.get('CHERRY_MANAGED') === true) {
        const readYamlString = (key: string): string | undefined => {
          const val = document.get(key)
          return typeof val === 'string' && val ? val : undefined
        }
        const provider = readYamlString('GOOSE_PROVIDER')
        const model = readYamlString('GOOSE_MODEL')
        if (provider) env.GOOSE_PROVIDER = provider
        if (model) {
          env.GOOSE_MODEL = model
          nativeModel = model
        }
        if (provider === 'anthropic') {
          const host = readYamlString('ANTHROPIC_HOST')
          const apiKey = readYamlString('ANTHROPIC_API_KEY')
          if (host) env.ANTHROPIC_HOST = host
          if (apiKey) env.ANTHROPIC_API_KEY = apiKey
        } else if (provider === 'openai') {
          const host = readYamlString('OPENAI_HOST')
          const apiKey = readYamlString('OPENAI_API_KEY')
          if (host) env.OPENAI_HOST = host
          if (apiKey) env.OPENAI_API_KEY = apiKey
        }
      }
    }
    return nativeModel
  }

  return undefined
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
  let shellEnv = await getRawShellEnv(signal)
  let lookupEnv = mergeEnvironment(shellEnv, preset?.env, config.env)
  let executable: string | undefined
  let source = 'system'
  let nativeAntigravity = false
  if (config.executableOverride && !(terminal && (definition?.terminalExecutable || config.presetId === 'pi-acp'))) {
    executable = path.isAbsolute(config.executableOverride)
      ? config.executableOverride
      : ((await findExecutableInEnv(config.executableOverride, { env: lookupEnv })) ?? undefined)
    if (!executable) throw new Error('Local agent executable was not found')
    if (!(await fs.stat(executable)).isFile()) throw new Error('Local agent executable is not a file')
    await fs.access(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    const root = application.getPath('feature.binary.data')
    if (await isManagedBinaryPath(executable, [root])) source = 'mise'
  } else if (preset) {
    const names = [preset.executable, ...(preset.aliases ?? [])]
    const canUseNative = !terminal && preset.id === 'antigravity-acp' && !config.args.length
    if (canUseNative) names.push('agy')
    const snapshots = await application.get('BinaryManager').getToolSnapshots(names)
    let installation = await selectAvailableInstallation(preset, snapshots)
    if (canUseNative && installation.source === 'none') {
      installation = await selectAvailableInstallation({ executable: 'agy' }, snapshots)
      nativeAntigravity = true
    }
    executable = installation.source !== 'none' ? installation.path : undefined
    source = installation.source
  }
  if (!executable) {
    throw Object.assign(new Error('Local agent is not installed'), { code: 'LOCAL_AGENT_NOT_INSTALLED' })
  }
  if (config.presetId && application.get('LocalAgentInstallService').isUninstalling(config.presetId))
    throw new Error('Local agent is being uninstalled')
  const dependencies = !terminal && definition?.terminalExecutable ? [definition.terminalExecutable] : []
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
  if (config.presetId === 'deepseek-harness') env.DSH_HOME = application.getPath('external.deepseek_harness.config')
  if (config.presetId === 'openclaw') {
    env.OPENCLAW_STATE_DIR = application.getPath('external.openclaw.config')
    env.OPENCLAW_CONFIG_PATH = application.getPath('external.openclaw.config', 'openclaw.json')
    env.OPENCLAW_NO_AUTO_UPDATE = '1'
  }
  const nativeModel = !terminal ? await injectPresetConfigEnv(config.presetId, env, mode) : undefined
  if (config.presetId === 'pi-acp' && !terminal && !config.executableOverride) {
    const nativeExecutable = executable
    const finalEnv = mergeEnvironment(env, preset?.env, config.env)
    const runtime = await resolveRequiredRuntime({ executable: 'node', minimumVersion: '20.0.0' }, finalEnv)
    if (!runtime) throw new Error(t('local_agent.runtime_required', { runtime: 'Node.js', version: '20' }))
    return {
      executable: runtime.path,
      source: runtime.source,
      args: [application.getPath('app.pi_acp.file'), ...config.args],
      env: {
        ...(runtime.source === 'mise'
          ? mergeBinaryExecutionEnv(finalEnv, [path.dirname(runtime.path)])
          : mergePathPrefixes(finalEnv, [path.dirname(runtime.path)])),
        PI_ACP_PI_COMMAND: finalEnv.PI_ACP_PI_COMMAND || nativeExecutable
      }
    }
  }
  let childEnv = mergeEnvironment(env, preset?.env, config.env)
  if (preset?.id === 'antigravity-acp' && !terminal && !nativeAntigravity && !config.executableOverride) {
    // The adapter's WebSocket client prefers macOS SOCKS settings over HTTPS_PROXY, but ships without python-socks.
    const agentProxy = Object.keys(config.env).some((key) => /^(https?|all|socks)_proxy$/i.test(key))
    const appliedProxy = getProxyEnvironment()
    const useAppliedProxy = !agentProxy && !!appliedProxy[CHERRY_NODE_PROXY_RULES_ENV]
    if (useAppliedProxy) childEnv = mergeEnvironment(childEnv, appliedProxy, config.env)
    const proxyEnv = agentProxy ? mergeEnvironment(config.env) : useAppliedProxy ? appliedProxy : childEnv
    const secureProxy = proxyEnv.https_proxy ?? proxyEnv.HTTPS_PROXY
    const generalProxy = proxyEnv.all_proxy ?? proxyEnv.ALL_PROXY
    const websocketProxies = {
      WS_PROXY: secureProxy ?? proxyEnv.http_proxy ?? proxyEnv.HTTP_PROXY ?? generalProxy,
      WSS_PROXY: secureProxy ?? generalProxy
    }
    for (const [key, proxy] of Object.entries(websocketProxies)) {
      if (!(key in childEnv) && !(key.toLowerCase() in childEnv) && proxy && /^https?:\/\//i.test(proxy)) {
        childEnv[key] = proxy
      }
    }
  }
  return {
    executable,
    ...(nativeModel ? { nativeModel } : {}),
    source,
    args: nativeAntigravity
      ? ['acp']
      : config.args.length
        ? config.args
        : [...(preset?.platformArgs?.[process.platform as 'linux' | 'darwin' | 'win32'] ?? preset?.args ?? [])],
    env: childEnv
  }
}

export async function openLocalAgentTerminal(config: InputFor<'ai.local_agents.open_terminal'>) {
  const preset = LOCAL_AGENT_PRESETS.find((entry) => entry.id === config.presetId)
  if (!preset?.terminalArgs) throw new Error('This agent does not have a supported interactive CLI')
  let args = config.login ? preset.loginArgs : preset.terminalArgs
  if (!args) throw new Error('This agent does not have a supported terminal login command')
  if (typeof config.login === 'object') {
    if (preset.id !== 'pi-acp') throw new Error('Only Pi accepts a login provider')
    args = [...args, config.login.provider]
  } else if (config.login && preset.id === 'pi-acp') {
    throw new Error('Pi login requires a provider')
  }
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
