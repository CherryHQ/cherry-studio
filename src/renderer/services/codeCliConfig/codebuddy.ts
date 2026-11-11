import type { EndpointType } from '@shared/data/types/model'
import { formatApiHost } from '@shared/utils/api'
import { getCliConfigTargets } from '@shared/utils/cliConfig'

import type { CliConfigAdapter } from './adapters'
import { getDraftFile, makeDraftFile, readAndParseDraftFile, readConfigFilesForDraft } from './draftFiles'
import { parseJsonOrThrow, readConfigFiles, readValidatedJsonOrNull, renderJsonFile } from './file'
import { resolveSupportedEndpointType } from './resolvers'
import { stringValue } from './values'

const ENDPOINTS: EndpointType[] = ['openai-chat-completions', 'openai-responses']
const OWNER = 'x-cherry-studio'

function modelEntries(config: Record<string, any>): Record<string, any>[] {
  if (config.models === undefined) return []
  if (!Array.isArray(config.models)) throw new Error('CodeBuddy models must be an array')
  return config.models
}

export const codebuddyAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets('codebuddy-code'),
  providerBaseUrls: (provider) =>
    ENDPOINTS.flatMap((type) => {
      const url = provider.endpointConfigs?.[type]?.baseUrl
      return url ? [formatApiHost(url)] : []
    }),
  sanitize: () => ({}),
  async buildDraft(args, { provider, apiKey, model, modelLabel, modelRecord }) {
    const endpoint = resolveSupportedEndpointType(provider, modelRecord?.endpointTypes, ENDPOINTS, ENDPOINTS[0])
    const baseUrl = formatApiHost(provider.endpointConfigs?.[endpoint]?.baseUrl)
    const read = await readConfigFilesForDraft(this.targets, args.files)
    const models = readAndParseDraftFile('codebuddy-models', parseJsonOrThrow, args.files, read)
    const settings = readAndParseDraftFile('codebuddy-settings', parseJsonOrThrow, args.files, read)
    const retained = modelEntries(models).filter((entry) => entry[OWNER] !== true)
    if (retained.some((entry) => entry.id === model)) {
      throw new Error('CodeBuddy already has a custom model with this ID. Edit its CLI configuration first.')
    }
    const entry = {
      id: model,
      name: modelLabel ?? model,
      vendor: provider.name,
      apiKey,
      url: endpoint === 'openai-responses' ? baseUrl : `${baseUrl.replace(/\/$/, '')}/chat/completions`,
      api: endpoint === 'openai-responses' ? 'openai-responses' : 'openai-completions',
      supportsToolCall: true,
      supportsImages: Boolean(modelRecord?.inputModalities?.includes('image')),
      supportsReasoning: Boolean(modelRecord?.reasoning),
      ...(modelRecord?.contextWindow ? { maxInputTokens: modelRecord.contextWindow } : {}),
      ...(modelRecord?.maxOutputTokens ? { maxOutputTokens: modelRecord.maxOutputTokens } : {}),
      [OWNER]: true
    }
    return [
      makeDraftFile('codebuddy-models', renderJsonFile({ ...models, models: [...retained, entry] }), read),
      makeDraftFile('codebuddy-settings', renderJsonFile({ ...settings, model }), read)
    ]
  },
  assertCredentials({ provider, apiKey, modelRecord }) {
    const endpoint = resolveSupportedEndpointType(provider, modelRecord?.endpointTypes, ENDPOINTS, ENDPOINTS[0])
    if (!apiKey || !provider.endpointConfigs?.[endpoint]?.baseUrl) {
      throw new Error('CodeBuddy config is missing required fields (apiKey/baseUrl)')
    }
  },
  updateDraftConfig: (files) => files,
  async buildClearFiles() {
    const read = await readConfigFiles(this.targets)
    const models = readValidatedJsonOrNull('codebuddy-models', read, 'CodeBuddy models config')
    if (!models) return []
    return [
      {
        target: 'codebuddy-models',
        content: renderJsonFile({ ...models, models: modelEntries(models).filter((entry) => entry[OWNER] !== true) })
      }
    ]
  },
  extractConnection(files) {
    const models = parseJsonOrThrow(getDraftFile(files, 'codebuddy-models')?.content ?? '')
    const settings = parseJsonOrThrow(getDraftFile(files, 'codebuddy-settings')?.content ?? '')
    const entry = modelEntries(models).find((entry) => entry.id === settings.model)
    if (!entry) return null
    return {
      model: stringValue(entry.id),
      apiKey: stringValue(entry.apiKey),
      baseUrl: stringValue(entry.url)?.replace(/\/chat\/completions\/?$/, '')
    }
  },
  extractConfig: () => ({})
}
