import { CODE_CLI_TOOL_PRESET_MAP, CODE_CLI_TOOL_PRESETS } from '@shared/data/presets/codeCliTools'
import type { CodeCli } from '@shared/types/codeCli'

/** Compatibility view of the shared Code CLI acquisition catalog. */
export interface CodeCliPackageSpec {
  readonly executable: string
  readonly packageName: string
  readonly install: 'registry' | 'npm'
}

export const CODE_CLI_PACKAGE_SPECS: Readonly<Record<CodeCli, Readonly<CodeCliPackageSpec>>> = Object.freeze(
  Object.fromEntries(
    CODE_CLI_TOOL_PRESETS.map(({ id, executable, packageName, install }) => [
      id,
      Object.freeze({ executable, packageName, install })
    ])
  ) as Record<CodeCli, CodeCliPackageSpec>
)

export function getCodeCliPackageSpec(cliTool: CodeCli): Readonly<CodeCliPackageSpec> {
  return CODE_CLI_PACKAGE_SPECS[cliTool]
}

/** `BinaryManager` install spec derived from the shared acquisition catalog. */
export function getCodeCliInstallSpec(cliTool: CodeCli): { name: string; tool: string } {
  const preset = CODE_CLI_TOOL_PRESET_MAP[cliTool]
  return { name: preset.executable, tool: preset.miseTool }
}
