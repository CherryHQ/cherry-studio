import { t } from 'i18next'

import { MODEL_CAPABILITY, type EndpointType } from '@shared/data/types/model'
import { CodeCli } from '@shared/types/codeCli'
import { formatApiHost } from '@shared/utils/api'
import { type CliConfigWriteFile, getCliConfigTargets } from '@shared/utils/cliConfig'

import type { CliConfigAdapter } from './adapters'
import { CHERRY_PROVIDER_PREFIX } from './constants'
import { getDraftFile, makeDraftFile, readAndParseDraftFile, readConfigFilesForDraft } from './draftFiles'
import { parseJsonOrThrow, readConfigFiles, readValidatedJsonOrNull, renderJsonFile } from './file'
import { resolveClaudeBaseUrl, resolveSupportedEndpointType } from './resolvers'
import { cliProviderKeyName, stringValue } from './values'

const ENDPOINTS: EndpointType[] = ['anthropic-messages', 'openai-responses', 'openai-chat-completions']

function entries(config: Record<string, any>, key: 'providers' | 'models'): Record<string, any>[] {
  if (config[key] === undefined) return []
  if (!Array.isArray(config[key]))
    throw new Error(t('code.cli_config.invalid_model_list', { tool: 'Copilot', field: key }))
  return config[key]
}

function managed(name: unknown): name is string {
  return typeof name === 'string' && name.startsWith(CHERRY_PROVIDER_PREFIX)
}

export const copilotAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets(CodeCli.GITHUB_COPILOT_CLI),
  providerBaseUrls: (provider) =>
    ENDPOINTS.flatMap((type) => {
      const url = provider.endpointConfigs?.[type]?.baseUrl
      return url ? [type === 'anthropic-messages' ? resolveClaudeBaseUrl(provider) : formatApiHost(url)] : []
    }),
  sanitize: () => ({}),
  async buildDraft(args, { provider, apiKey, model, modelLabel, modelRecord }) {
    const endpoint = resolveSupportedEndpointType(provider, modelRecord?.endpointTypes, ENDPOINTS, ENDPOINTS[0])
    const name = `${CHERRY_PROVIDER_PREFIX}${cliProviderKeyName(provider)}`
    const baseUrl =
      endpoint === 'anthropic-messages'
        ? resolveClaudeBaseUrl(provider)
        : formatApiHost(provider.endpointConfigs?.[endpoint]?.baseUrl)
    const read = await readConfigFilesForDraft(['copilot-settings', 'copilot-providers'], args.files)
    const registry = readAndParseDraftFile('copilot-providers', parseJsonOrThrow, args.files, read)
    const settings = readAndParseDraftFile('copilot-settings', parseJsonOrThrow, args.files, read)
    return [
      makeDraftFile(
        'copilot-providers',
        renderJsonFile({
          ...registry,
          providers: [
            ...entries(registry, 'providers').filter((entry) => !managed(entry.name)),
            {
              name,
              baseUrl,
              apiKey,
              type: endpoint === 'anthropic-messages' ? 'anthropic' : 'openai',
              wireApi: endpoint === 'openai-responses' ? 'responses' : 'completions',
              ...(provider.settings?.extraHeaders ? { headers: provider.settings.extraHeaders } : {})
            }
          ],
          models: [
            ...entries(registry, 'models').filter((entry) => !managed(entry.provider)),
            {
              id: model,
              provider: name,
              name: modelLabel ?? model,
              ...(modelRecord?.apiModelId ? { modelId: modelRecord.apiModelId } : {}),
              ...(modelRecord?.contextWindow ? { maxContextWindowTokens: modelRecord.contextWindow } : {}),
              ...(modelRecord?.maxInputTokens ? { maxPromptTokens: modelRecord.maxInputTokens } : {}),
              ...(modelRecord?.maxOutputTokens ? { maxOutputTokens: modelRecord.maxOutputTokens } : {}),
              ...(modelRecord
                ? {
                    capabilities: {
                      supports: {
                        toolCalls: modelRecord.capabilities.includes(MODEL_CAPABILITY.FUNCTION_CALL),
                        streaming: modelRecord.supportsStreaming,
                        vision: !!modelRecord.inputModalities?.includes('image')
                      }
                    }
                  }
                : {})
            }
          ]
        }),
        read
      ),
      makeDraftFile('copilot-settings', renderJsonFile({ ...settings, model: `${name}/${model}` }), read)
    ]
  },
  assertCredentials(context) {
    if (!context.apiKey || !this.providerBaseUrls(context.provider).length) {
      throw new Error(t('code.cli_config.missing_credentials', { tool: 'Copilot' }))
    }
  },
  updateDraftConfig: (files) => files,
  async buildClearFiles() {
    const read = await readConfigFiles(['copilot-settings', 'copilot-providers'])
    const registry = readValidatedJsonOrNull('copilot-providers', read, 'Copilot providers')
    const settings = readValidatedJsonOrNull('copilot-settings', read, 'Copilot settings')
    const files: CliConfigWriteFile[] = []
    if (registry) {
      files.push({
        target: 'copilot-providers' as const,
        content: renderJsonFile({
          ...registry,
          providers: entries(registry, 'providers').filter((entry) => !managed(entry.name)),
          models: entries(registry, 'models').filter((entry) => !managed(entry.provider))
        })
      })
    }
    if (settings && managed(settings.model)) {
      delete settings.model
      files.push({ target: 'copilot-settings' as const, content: renderJsonFile(settings) })
    }
    return files
  },
  extractConnection(files) {
    const registry = parseJsonOrThrow(getDraftFile(files, 'copilot-providers')?.content ?? '')
    const provider = entries(registry, 'providers').find((entry) => managed(entry.name))
    const model = entries(registry, 'models').find((entry) => entry.provider === provider?.name)
    return provider
      ? { baseUrl: stringValue(provider.baseUrl), apiKey: stringValue(provider.apiKey), model: stringValue(model?.id) }
      : null
  },
  extractConfig: () => ({})
}
