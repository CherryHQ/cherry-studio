import { t } from 'i18next'

import type { EndpointType } from '@shared/data/types/model'
import { formatApiHost } from '@shared/utils/api'
import { getCliConfigTargets } from '@shared/utils/cliConfig'

import type { CliConfigAdapter } from './adapters'
import { getDraftFile, makeDraftFile, readAndParseDraftFile, readConfigFilesForDraft } from './draftFiles'
import { parseJsonOrThrow, readConfigFiles, readValidatedJsonOrNull, renderJsonFile } from './file'
import { resolveClaudeBaseUrl, resolveSupportedEndpointType } from './resolvers'
import { asRecord, stringValue } from './values'

const ENDPOINTS: EndpointType[] = ['anthropic-messages', 'openai-responses', 'openai-chat-completions']
const LABEL_PREFIX = '[Cherry Studio] '

function modelEntries(config: Record<string, any>): Record<string, any>[] {
  if (config.customModels === undefined) return []
  if (!Array.isArray(config.customModels))
    throw new Error(t('code.cli_config.invalid_model_list', { tool: 'Droid', field: 'customModels' }))
  return config.customModels
}

function managed(entry: Record<string, any>): boolean {
  return typeof entry.displayName === 'string' && entry.displayName.startsWith(LABEL_PREFIX)
}

export const factoryAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets('factory-droid'),
  providerBaseUrls: (provider) =>
    ENDPOINTS.flatMap((type) => {
      const url = provider.endpointConfigs?.[type]?.baseUrl
      return url ? [type === 'anthropic-messages' ? resolveClaudeBaseUrl(provider) : formatApiHost(url)] : []
    }),
  sanitize: () => ({}),
  async buildDraft(args, { provider, apiKey, model, modelLabel, modelRecord }) {
    const endpoint = resolveSupportedEndpointType(provider, modelRecord?.endpointTypes, ENDPOINTS, ENDPOINTS[0])
    const baseUrl =
      endpoint === 'anthropic-messages'
        ? resolveClaudeBaseUrl(provider)
        : formatApiHost(provider.endpointConfigs?.[endpoint]?.baseUrl)
    const read = await readConfigFilesForDraft(this.targets, args.files)
    const settings = readAndParseDraftFile('factory-settings', parseJsonOrThrow, args.files, read)
    const retained = modelEntries(settings).filter((entry) => !managed(entry))
    if (retained.some((entry) => entry.model === model)) {
      throw new Error(t('code.cli_config.model_conflict', { tool: 'Droid' }))
    }
    const entry = {
      model,
      displayName: `${LABEL_PREFIX}${modelLabel ?? model}`,
      baseUrl,
      apiKey,
      provider:
        endpoint === 'anthropic-messages'
          ? 'anthropic'
          : endpoint === 'openai-responses'
            ? 'openai'
            : 'generic-chat-completion-api',
      ...(modelRecord?.maxOutputTokens ? { maxOutputTokens: modelRecord.maxOutputTokens } : {}),
      ...(modelRecord?.maxInputTokens ? { maxContextLimit: modelRecord.maxInputTokens } : {})
    }
    return [
      makeDraftFile(
        'factory-settings',
        renderJsonFile({
          ...settings,
          customModels: [...retained, entry],
          sessionDefaultSettings: { ...asRecord(settings.sessionDefaultSettings), model: `custom:${model}` }
        }),
        read
      )
    ]
  },
  assertCredentials(context) {
    if (!context.apiKey || !this.providerBaseUrls(context.provider).length) {
      throw new Error(t('code.cli_config.missing_credentials', { tool: 'Droid' }))
    }
  },
  updateDraftConfig: (files) => files,
  async buildClearFiles() {
    const read = await readConfigFiles(this.targets)
    const settings = readValidatedJsonOrNull('factory-settings', read, 'Droid settings')
    if (!settings) return []
    const entries = modelEntries(settings)
    const defaults = { ...asRecord(settings.sessionDefaultSettings) }
    if (entries.some((entry) => managed(entry) && defaults.model === `custom:${entry.model}`)) delete defaults.model
    return [
      {
        target: 'factory-settings',
        content: renderJsonFile({
          ...settings,
          customModels: entries.filter((entry) => !managed(entry)),
          sessionDefaultSettings: defaults
        })
      }
    ]
  },
  extractConnection(files) {
    const settings = parseJsonOrThrow(getDraftFile(files, 'factory-settings')?.content ?? '')
    const entry = modelEntries(settings).find(managed)
    return entry
      ? { baseUrl: stringValue(entry.baseUrl), apiKey: stringValue(entry.apiKey), model: stringValue(entry.model) }
      : null
  },
  extractConfig: () => ({})
}
