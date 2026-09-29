import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { appendBundledGitPathTail, isPathWithin, mergeBinaryExecutionEnv } from '@main/utils/binaryEnv'
import { findExecutableInEnv } from '@main/utils/commandResolver'
import { getRawShellEnv } from '@main/utils/shellEnv'
import {
  LOCAL_AGENT_PRESETS,
  type LocalAgentPreset,
  type LocalAgentConfiguration,
  type LocalAgentDetection
} from '@shared/ai/localAgent'
import type { BinaryToolSnapshot } from '@shared/types/binary'

function selectInstallation(preset: LocalAgentPreset, snapshots: Record<string, BinaryToolSnapshot>) {
  const candidates = [preset.executable, ...(preset.aliases ?? [])].map((name) => snapshots[name]?.availability)
  return (
    candidates.find((value) => value?.source === 'mise') ??
    candidates.find((value) => value && value.source !== 'none') ?? { source: 'none' as const }
  )
}

export function systemAgentEntry(executable: string): string {
  return application.getPath('external.acp.bin', `${executable}${process.platform === 'win32' ? '.cmd' : ''}`)
}

async function selectAvailableInstallation(preset: LocalAgentPreset, snapshots: Record<string, BinaryToolSnapshot>) {
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
    .getToolSnapshots(LOCAL_AGENT_PRESETS.flatMap((preset) => [preset.executable, ...(preset.aliases ?? [])]))
  return Promise.all(
    LOCAL_AGENT_PRESETS.map(async (preset) => ({
      presetId: preset.id,
      ...(await selectAvailableInstallation(preset, snapshots))
    }))
  )
}

export async function resolveLocalAgentLaunch(config: LocalAgentConfiguration, signal?: AbortSignal) {
  const preset = LOCAL_AGENT_PRESETS.find((p) => p.id === config.presetId)
  if (config.presetId && (!preset || preset.protocol !== config.protocol)) throw new Error('Invalid local agent preset')
  if (config.presetId && application.get('LocalAgentInstallService').isUninstalling(config.presetId))
    throw new Error('Local agent is being uninstalled')
  const shellEnv = await getRawShellEnv(signal)
  let executable: string | undefined
  let source = 'system'
  if (config.executableOverride) {
    executable = path.isAbsolute(config.executableOverride)
      ? config.executableOverride
      : ((await findExecutableInEnv(config.executableOverride, { env: shellEnv })) ?? undefined)
    if (!executable) throw new Error('Local agent executable was not found')
    if (!(await fs.stat(executable)).isFile()) throw new Error('Local agent executable is not a file')
    await fs.access(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    const root = application.getPath('feature.binary.data')
    if (isPathWithin(root, executable)) source = 'mise'
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
  return {
    executable,
    args: config.args.length
      ? config.args
      : [...(preset?.platformArgs?.[process.platform as 'linux' | 'darwin' | 'win32'] ?? preset?.args ?? [])],
    env: { ...env, ...preset?.env, ...config.env }
  }
}
