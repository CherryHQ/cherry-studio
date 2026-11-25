import { t } from 'i18next'
import { stringify } from 'smol-toml'

import type { EndpointType } from '@shared/data/types/model'
import { formatApiHost } from '@shared/utils/api'
import { type CliConfigWriteFile, getCliConfigTargets } from '@shared/utils/cliConfig'

import type { CliConfigAdapter } from './adapters'
import { CHERRY_PROVIDER_PREFIX } from './constants'
import { parseDotenv, renderDotenvFile } from './dotenv'
import {
  getDraftFile,
  makeDraftFile,
  readAndParseDraftFile,
  readConfigFilesForDraft,
  readDraftFileText
} from './draftFiles'
import { parseTomlOrThrow, readConfigFiles, readValidatedTomlOrNull, requireReadFile } from './file'
import { resolveClaudeBaseUrl, resolveSupportedEndpointType } from './resolvers'
import { cliProviderKeyName, stringValue } from './values'

const ENDPOINTS: EndpointType[] = ['anthropic-messages', 'openai-responses', 'openai-chat-completions']
const API_KEY_ENV = 'CHERRY_VIBE_API_KEY'

function entries(config: Record<string, any>, key: 'providers' | 'models'): Record<string, any>[] {
  if (config[key] === undefined) return []
  if (!Array.isArray(config[key]))
    throw new Error(t('code.cli_config.invalid_model_list', { tool: 'Vibe', field: key }))
  return config[key]
}

function managed(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(CHERRY_PROVIDER_PREFIX)
}

export const vibeAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets('mistral-vibe'),
  providerBaseUrls: (provider) =>
    ENDPOINTS.flatMap((type) => {
      const url = provider.endpointConfigs?.[type]?.baseUrl
      return url ? [type === 'anthropic-messages' ? resolveClaudeBaseUrl(provider) : formatApiHost(url)] : []
    }),
  sanitize: () => ({}),
  async buildDraft(args, { provider, apiKey, model, modelLabel, modelRecord }) {
    const endpoint = resolveSupportedEndpointType(provider, modelRecord?.endpointTypes, ENDPOINTS, ENDPOINTS[0])
    const name = `${CHERRY_PROVIDER_PREFIX}${cliProviderKeyName(provider)}`
    const read = await readConfigFilesForDraft(this.targets, args.files)
    const config = readAndParseDraftFile('vibe-config', parseTomlOrThrow, args.files, read)
    const envText = readDraftFileText('vibe-env', args.files, read)
    const env = parseDotenv(envText)
    env.set(API_KEY_ENV, apiKey)
    return [
      makeDraftFile(
        'vibe-config',
        stringify({
          ...config,
          active_model: name,
          providers: [
            ...entries(config, 'providers').filter((entry) => !managed(entry.name)),
            {
              name,
              backend: 'generic',
              api_style:
                endpoint === 'anthropic-messages'
                  ? 'anthropic'
                  : endpoint === 'openai-responses'
                    ? 'openai-responses'
                    : 'openai',
              api_base:
                endpoint === 'anthropic-messages'
                  ? resolveClaudeBaseUrl(provider)
                  : formatApiHost(provider.endpointConfigs?.[endpoint]?.baseUrl),
              api_key_env_var: API_KEY_ENV,
              ...(provider.settings?.extraHeaders ? { extra_headers: provider.settings.extraHeaders } : {})
            }
          ],
          models: [
            ...entries(config, 'models').filter((entry) => !managed(entry.provider)),
            {
              name: model,
              provider: name,
              alias: name,
              display_name: modelLabel ?? model,
              ...(modelRecord?.contextWindow ? { max_context_length: modelRecord.contextWindow } : {}),
              ...(modelRecord?.maxOutputTokens ? { max_output_tokens: modelRecord.maxOutputTokens } : {}),
              ...(modelRecord ? { supports_images: !!modelRecord.inputModalities?.includes('image') } : {})
            }
          ]
        }),
        read
      ),
      makeDraftFile('vibe-env', renderDotenvFile(env, envText), read)
    ]
  },
  assertCredentials(context) {
    if (!context.apiKey || !this.providerBaseUrls(context.provider).length) {
      throw new Error(t('code.cli_config.missing_credentials', { tool: 'Vibe' }))
    }
  },
  updateDraftConfig: (files) => files,
  async buildClearFiles() {
    const read = await readConfigFiles(this.targets)
    const config = readValidatedTomlOrNull('vibe-config', read, 'Vibe config')
    const files: CliConfigWriteFile[] = []
    if (config) {
      if (managed(config.active_model)) delete config.active_model
      files.push({
        target: 'vibe-config' as const,
        content: stringify({
          ...config,
          providers: entries(config, 'providers').filter((entry) => !managed(entry.name)),
          models: entries(config, 'models').filter((entry) => !managed(entry.provider))
        })
      })
    }
    const envText = requireReadFile('vibe-env', read).content
    if (envText !== null) {
      const env = parseDotenv(envText)
      env.delete(API_KEY_ENV)
      files.push({ target: 'vibe-env' as const, content: renderDotenvFile(env, envText) })
    }
    return files
  },
  extractConnection(files) {
    const config = parseTomlOrThrow(getDraftFile(files, 'vibe-config')?.content ?? '')
    const provider = entries(config, 'providers').find((entry) => managed(entry.name))
    const model = entries(config, 'models').find((entry) => entry.provider === provider?.name)
    const env = parseDotenv(getDraftFile(files, 'vibe-env')?.content ?? '')
    return provider
      ? { baseUrl: stringValue(provider.api_base), apiKey: env.get(API_KEY_ENV), model: stringValue(model?.name) }
      : null
  },
  extractConfig: () => ({})
}
