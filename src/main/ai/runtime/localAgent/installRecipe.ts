import * as z from 'zod'

import { LOCAL_AGENT_PRESETS } from '@shared/ai/localAgent'
import { CODE_CLI_TOOL_PRESETS } from '@shared/data/presets/codeCliTools'

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
  // Native drivers need the original CLI, not the registry's ACP adapter.
  const native =
    preset.protocol !== 'acp'
      ? CODE_CLI_TOOL_PRESETS.find((entry) => entry.executable === preset.executable)
      : undefined
  const entry = native
    ? undefined
    : registrySchema.parse(registry).agents.find((agent) => agent.id === (registryIds[presetId] ?? presetId))
  const npmPackage = native?.packageName ?? entry?.distribution.npx?.package
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
