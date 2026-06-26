import { type CliProviderConfig, type CliProviderConfigMap, codeCLI } from '@shared/types/codeCli'

import { writeClaudeCodeConfig } from './claudeCodeConfig'
import { writeCodexConfig } from './codexConfig'
import { writeHermesConfig } from './hermesConfig'
import { writeOpenClawConfig } from './openclawConfig'
import { writeOpenCodeConfig } from './openCodeConfig'
// @legacy — removed in v2: writeGeminiConfig, writeKimiConfig, writeQwenConfig

type CliConfigWriters = {
  [K in keyof CliProviderConfigMap]: (config: CliProviderConfigMap[K]) => Promise<void>
}

/**
 * Writers for the CLIs that persist their provider selection to a native config file.
 */
const CLI_CONFIG_WRITERS: CliConfigWriters = {
  [codeCLI.claudeCode]: writeClaudeCodeConfig,
  [codeCLI.openaiCodex]: writeCodexConfig,
  [codeCLI.openCode]: writeOpenCodeConfig,
  [codeCLI.openclaw]: writeOpenClawConfig,
  [codeCLI.hermes]: writeHermesConfig
}

/** Returns the config-file writer for a CLI tool, or undefined for the env-based CLIs. */
export function getCliConfigWriter(cliTool: string): ((config: CliProviderConfig) => Promise<void>) | undefined {
  return (CLI_CONFIG_WRITERS as Record<string, (config: CliProviderConfig) => Promise<void>>)[cliTool]
}
