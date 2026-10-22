import * as z from 'zod'

import { LOCAL_AGENT_PRESETS } from '@shared/ai/localAgent'
import { CODE_CLI_TOOL_PRESETS, type CodeCliToolPreset } from '@shared/data/presets/codeCliTools'

const packageDistribution = z.object({ package: z.string().min(1) })
const binaryDistribution = z.object({
  archive: z.url().refine((value) => value.startsWith('https://')),
  cmd: z.string().min(1),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional()
})
const registrySchema = z.object({
  agents: z.array(
    z.object({
      id: z.string(),
      version: z
        .string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/)
        .optional(),
      distribution: z.object({
        npx: packageDistribution.optional(),
        uvx: packageDistribution.optional(),
        binary: z.record(z.string(), binaryDistribution).optional()
      })
    })
  )
})
const registryIds: Record<string, string> = {
  copilot: 'github-copilot-cli',
  minimax: 'minimax-code',
  qwen: 'qwen-code'
}

export interface LocalAgentInstallRecipe {
  manager: 'npm' | 'uv'
  package: string
  args: string[]
}

export interface LocalAgentBinaryRecipe {
  manager: 'binary'
  version: string
  archive: string
  cmd: string
  sha256?: string
}

export function resolveInstallRecipe(
  presetId: string,
  registry: unknown,
  platform = process.platform,
  arch = process.arch
): LocalAgentInstallRecipe | LocalAgentBinaryRecipe | undefined {
  const preset = LOCAL_AGENT_PRESETS.find((entry) => entry.id === presetId)
  if (!preset) throw new Error('Unknown local agent preset')
  // Native drivers need the original CLI; the registry still ships the retired Kimi CLI.
  const native =
    preset.protocol !== 'acp' || presetId === 'kimi'
      ? CODE_CLI_TOOL_PRESETS.find((entry) => entry.executable === preset.executable)
      : undefined
  const entry =
    native || preset.npmPackage
      ? undefined
      : registrySchema.parse(registry).agents.find((agent) => agent.id === (registryIds[presetId] ?? presetId))
  const npmPackage = native?.packageName ?? preset.npmPackage ?? entry?.distribution.npx?.package
  if (npmPackage) {
    if (!/^(@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*(?:@[a-zA-Z0-9.+_-]+)?$/.test(npmPackage)) {
      throw new Error('Invalid npm package in ACP registry')
    }
    return { manager: 'npm', package: npmPackage, args: ['install', '--global', npmPackage] }
  }
  const pythonPackage = entry?.distribution.uvx?.package
  if (pythonPackage) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\[[a-zA-Z0-9,._-]+\])?(?:==[a-zA-Z0-9.+_-]+)?$/.test(pythonPackage)) {
      throw new Error('Invalid Python package in ACP registry')
    }
    return { manager: 'uv', package: pythonPackage, args: ['tool', 'install', pythonPackage] }
  }
  const platformKey = `${platform === 'win32' ? 'windows' : platform}-${arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : arch}`
  const binary = entry?.distribution.binary?.[platformKey]
  if (binary && entry?.version) return { manager: 'binary', version: entry.version, ...binary }
  return undefined
}

export interface CliScriptRecipe {
  manager: 'script'
  command: string
  args: string[]
}

export function resolveCliInstallRecipe(
  preset: CodeCliToolPreset,
  targetVersion?: string,
  platform = process.platform
): LocalAgentInstallRecipe | CliScriptRecipe {
  if (targetVersion && !/^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/.test(targetVersion)) throw new Error('Invalid CLI version')
  if (preset.install === 'aqua') {
    if (targetVersion) throw new Error('Antigravity manages its own updates')
    return platform === 'win32'
      ? {
          manager: 'script',
          command: 'powershell.exe',
          args: [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "$ErrorActionPreference = 'Stop'; irm https://antigravity.google/cli/install.ps1 | iex"
          ]
        }
      : {
          manager: 'script',
          command: 'bash',
          args: ['-o', 'pipefail', '-c', 'curl -fsSL https://antigravity.google/cli/install.sh | bash']
        }
  }
  const python = preset.install === 'pipx'
  const packageName =
    python && preset.pipxExtras?.length ? `${preset.packageName}[${preset.pipxExtras.join(',')}]` : preset.packageName
  const packageSpec = targetVersion ? `${packageName}${python ? '==' : '@'}${targetVersion}` : packageName
  return python
    ? { manager: 'uv', package: packageSpec, args: ['tool', 'install', '--upgrade', packageSpec] }
    : { manager: 'npm', package: packageSpec, args: ['install', '--global', packageSpec] }
}
