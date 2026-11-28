import {
  clearCodeBuddyModels,
  readCodeBuddyConnection,
  writeCodeBuddyModel
} from '@cherrystudio/agent-runtime-codebuddy-acp'
import { codeBuddyCli } from '@cherrystudio/agent-runtime-codebuddy-acp/cli'
import { formatApiHost } from '@shared/utils/api'

import type { CliConfigAdapter } from './adapters'
import { getDraftFile, makeDraftFile, readAndParseDraftFile, readConfigFilesForDraft } from './draftFiles'
import { parseJsonOrThrow, readValidatedJsonOrNull, renderJsonFile } from './file'
import { resolveSupportedEndpointType } from './resolvers'
import { getCliConfigTargets } from './targets'
import { stringValue } from './values'

const ENDPOINTS = codeBuddyCli.modelEndpoints
export const codebuddyAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets(codeBuddyCli.modelConfig.tool),
  providerBaseUrls: (provider) =>
    ENDPOINTS.flatMap((type) => {
      const url = provider.endpointConfigs?.[type]?.baseUrl
      return url ? [formatApiHost(url)] : []
    }),
  sanitize: () => ({}),
  async buildDraft(args, { provider, apiKey, model, modelLabel, modelRecord }, reader) {
    const endpoint = resolveSupportedEndpointType(provider, modelRecord?.endpointTypes, ENDPOINTS, ENDPOINTS[0])
    const baseUrl = formatApiHost(provider.endpointConfigs?.[endpoint]?.baseUrl)
    const read = await readConfigFilesForDraft(reader, this.targets, args.files)
    const models = readAndParseDraftFile('codebuddy-models', parseJsonOrThrow, args.files, read)
    const settings = readAndParseDraftFile('codebuddy-settings', parseJsonOrThrow, args.files, read)
    const updated = writeCodeBuddyModel(models, {
      id: model,
      name: modelLabel ?? model,
      vendor: provider.name,
      apiKey,
      baseUrl,
      responses: endpoint === 'openai-responses',
      supportsImages: Boolean(modelRecord?.inputModalities?.includes('image')),
      supportsReasoning: Boolean(modelRecord?.reasoning),
      maxInputTokens: modelRecord?.contextWindow ?? undefined,
      maxOutputTokens: modelRecord?.maxOutputTokens ?? undefined
    })
    return [
      makeDraftFile('codebuddy-models', renderJsonFile(updated), read),
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
  async buildClearFiles(reader) {
    const read = await reader(this.targets)
    const models = readValidatedJsonOrNull('codebuddy-models', read, 'CodeBuddy models config')
    if (!models) return []
    return [
      {
        target: 'codebuddy-models',
        content: renderJsonFile(clearCodeBuddyModels(models))
      }
    ]
  },
  extractConnection(files) {
    const models = parseJsonOrThrow(getDraftFile(files, 'codebuddy-models')?.content ?? '')
    const settings = parseJsonOrThrow(getDraftFile(files, 'codebuddy-settings')?.content ?? '')
    const connection = readCodeBuddyConnection(models, settings.model)
    return connection
      ? {
          model: stringValue(connection.model),
          apiKey: stringValue(connection.apiKey),
          baseUrl: stringValue(connection.baseUrl)
        }
      : null
  },
  extractConfig: () => ({})
}
