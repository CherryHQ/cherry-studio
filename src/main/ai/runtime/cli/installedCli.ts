import { constants } from 'node:fs'
import fs from 'node:fs/promises'

import { lt, valid } from 'semver'

import { application } from '@application'
import type { InstalledCli } from '@cherrystudio/agent-runtime/cli'
import { isManagedBinaryPath } from '@main/utils/binaryResolver'
import type { LocalCliAgentPreset } from '@shared/ai/localAgent'
import type { BinaryAvailability, BinaryToolSnapshot } from '@shared/types/binary'

import { readInstalledPackageVersion } from './installedVersion'

type AgentCommand = Pick<LocalCliAgentPreset, 'executable' | 'aliases'> &
  Partial<Pick<LocalCliAgentPreset, 'protocol' | 'minimumAcpVersion'>>

export type InstalledBinary = InstalledCli<string, Exclude<BinaryAvailability['source'], 'none'>>

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

export async function inspectAgentInstallation(preset: AgentCommand, snapshots: Record<string, BinaryToolSnapshot>) {
  const available = await selectAvailableInstallation(preset, snapshots)
  const installed =
    available.source === 'none' && preset.protocol === 'acp' && preset.minimumAcpVersion
      ? await selectAvailableInstallation({ executable: preset.executable, aliases: preset.aliases }, snapshots)
      : available
  return { available, installed }
}
