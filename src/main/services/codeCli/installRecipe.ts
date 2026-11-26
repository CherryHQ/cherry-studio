import * as z from 'zod'

import type { CliInstallPlan } from '@cherrystudio/agent-runtime/cli'
import { LOCAL_CLI_AGENT_PRESETS } from '@shared/ai/localAgent'
import { CODE_CLI_TOOL_PRESETS, type CodeCliToolPreset } from '@shared/data/presets/codeCliTools'

import { cliInstallers, presetInstallRecipe } from './installPolicy'

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

export function resolveInstallRecipe(
  presetId: string,
  registry?: unknown,
  platform = process.platform,
  arch = process.arch
): CliInstallPlan | undefined {
  const preset = LOCAL_CLI_AGENT_PRESETS.find((entry) => entry.id === presetId)
  if (!preset) throw new Error('Unknown local agent preset')
  const native = preset.nativeCliInstall
    ? CODE_CLI_TOOL_PRESETS.find((entry) => entry.executable === preset.executable)
    : undefined
  if (native) return resolveCliInstallRecipe(native, undefined, platform)
  const custom = presetInstallRecipe.get(presetId)
  if (custom) return custom(platform)
  const entry = preset.npmPackage
    ? undefined
    : registry === undefined
      ? undefined
      : registrySchema.parse(registry).agents.find((agent) => agent.id === (preset.registryId ?? presetId))
  const npmPackage = preset.npmPackage ?? entry?.distribution.npx?.package
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
  const binary =
    entry?.distribution.binary?.[platformKey] ??
    (platform === 'win32' && arch === 'arm64' ? entry?.distribution.binary?.['windows-x86_64'] : undefined)
  if (binary && entry?.version) return { manager: 'binary', version: entry.version, ...binary }
  return undefined
}

export function resolveCliInstallRecipe(
  preset: CodeCliToolPreset,
  targetVersion?: string,
  platform = process.platform
): Exclude<CliInstallPlan, { manager: 'binary' }> {
  if (targetVersion && !/^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/.test(targetVersion)) throw new Error('Invalid CLI version')
  const installer = cliInstallers.get(preset.executable)
  if (installer) {
    const recipe = installer.script(platform, targetVersion)
    if (!recipe) throw new Error('Unsupported CLI installation platform')
    return recipe
  }
  const python = preset.install === 'pipx'
  const packageName =
    python && preset.pipxExtras?.length ? `${preset.packageName}[${preset.pipxExtras.join(',')}]` : preset.packageName
  const packageSpec = targetVersion ? `${packageName}${python ? '==' : '@'}${targetVersion}` : packageName
  return python
    ? { manager: 'uv', package: packageSpec, args: ['tool', 'install', '--upgrade', packageSpec] }
    : { manager: 'npm', package: packageSpec, args: ['install', '--global', packageSpec] }
}
