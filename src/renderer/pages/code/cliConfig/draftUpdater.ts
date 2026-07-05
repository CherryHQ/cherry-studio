import { CodeCli } from '@shared/types/codeCli'
import { stringify as stringifyToml } from 'smol-toml'

import {
  buildClaudeConfig,
  buildCodexAuthConfig,
  buildCodexConfig,
  buildGeminiEnvConfig,
  buildGeminiSettingsConfig,
  buildKimiConfig,
  buildOpenCodeConfig,
  buildQwenConfig
} from './builders'
import { CHERRY_PROVIDER_PREFIX } from './constants'
import { parseDotenv } from './dotenv'
import { getDraftFile } from './draftFiles'
import { parseJsonOrThrow, parseTomlOrThrow, renderDotenvFile, renderJsonFile } from './file'
import { extractConnectionFromCliConfigDraft } from './parser'
import { openCodeNpmInfoFromNpmPackage } from './resolvers'
import { sanitizeCliConfigBlob } from './sanitize'
import type { CliConfigFileDraft, CliConfigTarget } from './types'
import { asRecord, findCherryProviderKey, numberValue, stringValue } from './values'

export function formatCliConfigDraftFile(file: CliConfigFileDraft): CliConfigFileDraft {
  if (file.language !== 'json') return file
  return { ...file, content: renderJsonFile(parseJsonOrThrow(file.content)) }
}

function replaceDraftContent(
  files: CliConfigFileDraft[],
  target: CliConfigTarget,
  content: string
): CliConfigFileDraft[] {
  return files.map((file) => (file.target === target ? { ...file, content } : file))
}

function requireDraftValue(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`Cannot update CLI config draft: missing ${label}`)
  }
  return value
}

function providerNameFromKey(providerKey: string | undefined, label: string): string {
  const key = requireDraftValue(providerKey, label)
  if (!key.startsWith(CHERRY_PROVIDER_PREFIX)) {
    throw new Error(`Cannot update CLI config draft: ${label} is not managed by Cherry Studio`)
  }
  return key.slice(CHERRY_PROVIDER_PREFIX.length)
}

function cherryProviderKeyFrom(providers: Record<string, any>): string {
  return requireDraftValue(findCherryProviderKey(providers), 'OpenCode provider')
}

export function updateCliConfigDraftConfig(
  cliTool: string,
  files: CliConfigFileDraft[],
  configBlob: Record<string, unknown>
): CliConfigFileDraft[] {
  const connection = extractConnectionFromCliConfigDraft(cliTool, files)
  const blob = sanitizeCliConfigBlob(cliTool, asRecord(configBlob))
  if (!connection) return files

  switch (cliTool) {
    case CodeCli.CLAUDE_CODE: {
      const settings = parseJsonOrThrow(getDraftFile(files, 'claude-settings')?.content ?? '')
      return replaceDraftContent(
        files,
        'claude-settings',
        renderJsonFile(
          buildClaudeConfig(settings, blob, {
            apiKey: connection.apiKey ?? '',
            baseUrl: connection.baseUrl ?? '',
            model: connection.model ?? ''
          })
        )
      )
    }
    case CodeCli.OPENAI_CODEX: {
      const config = parseTomlOrThrow(getDraftFile(files, 'codex-config')?.content ?? '')
      const auth = parseJsonOrThrow(getDraftFile(files, 'codex-auth')?.content ?? '')
      const providerKey = stringValue(config.model_provider)
      const providerName = providerNameFromKey(providerKey, 'Codex model_provider')
      const nextConfig = buildCodexConfig(
        config,
        {
          baseUrl: requireDraftValue(connection.baseUrl, 'Codex base URL'),
          providerName,
          model: requireDraftValue(connection.model, 'Codex model')
        },
        blob
      )
      return replaceDraftContent(
        replaceDraftContent(files, 'codex-config', stringifyToml(nextConfig)),
        'codex-auth',
        connection.apiKey ? renderJsonFile(buildCodexAuthConfig(auth, connection.apiKey)) : renderJsonFile(auth)
      )
    }
    case CodeCli.OPEN_CODE: {
      const existing = parseJsonOrThrow(getDraftFile(files, 'opencode-config')?.content ?? '')
      const providers = asRecord(existing.provider)
      const providerKey = cherryProviderKeyFrom(providers)
      const provider = asRecord(providers[providerKey])
      const providerName = providerNameFromKey(providerKey, 'OpenCode provider')
      const env = asRecord(blob.env)
      const nextConfig = buildOpenCodeConfig(
        existing,
        { id: providerName, name: providerName },
        openCodeNpmInfoFromNpmPackage(requireDraftValue(stringValue(provider.npm), 'OpenCode provider npm package')),
        {
          apiKey: requireDraftValue(connection.apiKey, 'OpenCode API key'),
          baseUrl: requireDraftValue(connection.baseUrl, 'OpenCode base URL'),
          model: requireDraftValue(connection.model, 'OpenCode model')
        },
        {
          reasoning: env.OPENCODE_REASONING === 'true',
          supportsReasoningEffort: true,
          autoCompact: blob.autoCompact === true,
          permissionMode: blob.permissionMode
        }
      )
      return replaceDraftContent(files, 'opencode-config', renderJsonFile(nextConfig))
    }
    case CodeCli.GEMINI_CLI: {
      const envMap = parseDotenv(getDraftFile(files, 'gemini-env')?.content ?? '')
      const settings = parseJsonOrThrow(getDraftFile(files, 'gemini-settings')?.content ?? '')
      return replaceDraftContent(
        replaceDraftContent(
          files,
          'gemini-env',
          renderDotenvFile(
            buildGeminiEnvConfig(envMap, { apiKey: connection.apiKey ?? '', baseUrl: connection.baseUrl ?? '' })
          )
        ),
        'gemini-settings',
        renderJsonFile(
          buildGeminiSettingsConfig(settings, { model: requireDraftValue(connection.model, 'Gemini model') }, blob)
        )
      )
    }
    case CodeCli.QWEN_CODE: {
      const existing = parseJsonOrThrow(getDraftFile(files, 'qwen-settings')?.content ?? '')
      const model = requireDraftValue(connection.model, 'Qwen model')
      return replaceDraftContent(
        files,
        'qwen-settings',
        renderJsonFile(
          buildQwenConfig(
            existing,
            {
              apiKey: requireDraftValue(connection.apiKey, 'Qwen API key'),
              baseUrl: requireDraftValue(connection.baseUrl, 'Qwen base URL'),
              model,
              modelLabel: model
            },
            blob
          )
        )
      )
    }
    case CodeCli.KIMI_CODE: {
      const existing = parseTomlOrThrow(getDraftFile(files, 'kimi-config')?.content ?? '')
      const modelKey = requireDraftValue(stringValue(existing.default_model), 'Kimi default model')
      const maxContextSize = numberValue(asRecord(asRecord(existing.models)[modelKey]).max_context_size)
      return replaceDraftContent(
        files,
        'kimi-config',
        stringifyToml(
          buildKimiConfig(
            existing,
            {
              apiKey: requireDraftValue(connection.apiKey, 'Kimi API key'),
              baseUrl: requireDraftValue(connection.baseUrl, 'Kimi base URL'),
              model: requireDraftValue(connection.model, 'Kimi model'),
              modelKey,
              maxContextSize
            },
            blob
          )
        )
      )
    }
    default:
      return files
  }
}
