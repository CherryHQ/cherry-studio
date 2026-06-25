import { type CliProviderConfig, type CliProviderConfigMap, codeCLI } from '@shared/types/codeCli'

import { writeClaudeCodeConfig } from './claudeCodeConfig'
import { writeCodexConfig } from './codexConfig'
import { writeGeminiConfig } from './geminiConfig'
import { writeKimiConfig } from './kimiConfig'
import { writeOpenCodeConfig } from './openCodeConfig'
import { writeQwenConfig } from './qwenConfig'

type CliConfigWriters = {
  [K in keyof CliProviderConfigMap]: (config: CliProviderConfigMap[K]) => Promise<void>
}

/**
 * Writers for the CLIs that persist their provider selection to a native config file. The remaining
 * CLIs (qoder-cli, github-copilot-cli) have no such file and stay env-based.
 */
const CLI_CONFIG_WRITERS: CliConfigWriters = {
  [codeCLI.claudeCode]: writeClaudeCodeConfig,
  [codeCLI.openaiCodex]: writeCodexConfig,
  [codeCLI.geminiCli]: writeGeminiConfig,
  [codeCLI.qwenCode]: writeQwenConfig,
  [codeCLI.kimiCli]: writeKimiConfig,
  [codeCLI.openCode]: writeOpenCodeConfig
}

/** Returns the config-file writer for a CLI tool, or undefined for the env-based CLIs. */
export function getCliConfigWriter(cliTool: string): ((config: CliProviderConfig) => Promise<void>) | undefined {
  return (CLI_CONFIG_WRITERS as Record<string, (config: CliProviderConfig) => Promise<void>>)[cliTool]
}
