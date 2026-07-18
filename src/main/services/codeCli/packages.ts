import { CodeCli } from '@shared/types/codeCli'

/**
 * Per-tool acquisition facts for the CLI binaries `CodeCliService` manages.
 *
 * - `executable`: binary/shim name on PATH — used for the existence probe,
 *   `--version`, and spawn.
 * - `packageName`: npm package name used to build the `npm:<packageName>`
 *   install spec.
 * - `install`: how `BinaryManager` acquires it — a mise registry short-name
 *   (`'registry'`, which is always the `executable`) or an explicit
 *   `npm:<packageName>` spec.
 *
 * Keeping all three in one row per tool is deliberate. They used to be parallel
 * `switch (cliTool)` blocks with no compiler link, so a scope rename that touched
 * only one silently diverged — the Kimi bug, where the install pointed at
 * `@moonshot-ai/kimi-code` while a sibling switch still named `kimi-code`. One
 * row makes them agree by construction.
 */
export interface CodeCliPackageSpec {
  executable: string
  packageName: string
  install: 'registry' | 'npm'
}

export const CODE_CLI_PACKAGE_SPECS: Record<CodeCli, CodeCliPackageSpec> = {
  [CodeCli.CLAUDE_CODE]: { executable: 'claude', packageName: '@anthropic-ai/claude-code', install: 'registry' },
  [CodeCli.OPENAI_CODEX]: { executable: 'codex', packageName: '@openai/codex', install: 'registry' },
  [CodeCli.OPEN_CODE]: { executable: 'opencode', packageName: 'opencode-ai', install: 'registry' },
  [CodeCli.OPENCLAW]: { executable: 'openclaw', packageName: 'openclaw', install: 'npm' },
  [CodeCli.GEMINI_CLI]: { executable: 'gemini', packageName: '@google/gemini-cli', install: 'npm' },
  [CodeCli.QWEN_CODE]: { executable: 'qwen', packageName: '@qwen-code/qwen-code', install: 'npm' },
  [CodeCli.KIMI_CODE]: { executable: 'kimi', packageName: '@moonshot-ai/kimi-code', install: 'npm' },
  [CodeCli.QODER_CLI]: { executable: 'qoderclicn', packageName: '@qodercn-ai/qoderclicn', install: 'npm' },
  [CodeCli.GITHUB_COPILOT_CLI]: { executable: 'copilot', packageName: '@github/copilot', install: 'npm' },
  [CodeCli.PI]: { executable: 'pi', packageName: '@earendil-works/pi-coding-agent', install: 'npm' }
}

export function getCodeCliPackageSpec(cliTool: CodeCli): CodeCliPackageSpec {
  return CODE_CLI_PACKAGE_SPECS[cliTool]
}

/** `BinaryManager` install spec: a mise registry short-name or `npm:<pkg>`. */
export function getCodeCliInstallSpec(cliTool: CodeCli): { name: string; tool: string } {
  const spec = getCodeCliPackageSpec(cliTool)
  return { name: spec.executable, tool: spec.install === 'npm' ? `npm:${spec.packageName}` : spec.executable }
}
