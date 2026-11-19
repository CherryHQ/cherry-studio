import { t } from 'i18next'

import { formatApiHost } from '@shared/utils/api'
import { getCliConfigTargets, POOLSIDE_GATEWAY_SERVER } from '@shared/utils/cliConfig'

import type { CliConfigAdapter } from './adapters'
import { getDraftFile, makeDraftFile, readAndParseDraftFile, readConfigFilesForDraft } from './draftFiles'
import { parseYamlDocumentOrThrow, parseYamlOrThrow, readConfigFiles, requireReadFile } from './file'

export const poolsideAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets('poolside'),
  providerBaseUrls: (provider) => {
    const url = provider.endpointConfigs?.['openai-chat-completions']?.baseUrl
    return url ? [formatApiHost(url)] : []
  },
  sanitize: () => ({}),
  async buildDraft(args, context) {
    this.assertCredentials(context)
    const read = await readConfigFilesForDraft(this.targets, args.files)
    const document = readAndParseDraftFile('poolside-settings', parseYamlDocumentOrThrow, args.files, read)
    document.setIn(['agent_servers', POOLSIDE_GATEWAY_SERVER], {
      type: 'custom',
      command: 'pool',
      args: ['acp'],
      env: {
        POOLSIDE_API_KEY: context.apiKey,
        POOLSIDE_STANDALONE_BASE_URL: this.providerBaseUrls(context.provider)[0],
        POOLSIDE_STANDALONE_MODEL: context.model
      },
      default_config_options: { model: context.model }
    })
    document.setIn(['pool', 'default_agent_server'], POOLSIDE_GATEWAY_SERVER)
    return [makeDraftFile('poolside-settings', document.toString(), read)]
  },
  assertCredentials(context) {
    if (!context.apiKey || !this.providerBaseUrls(context.provider).length)
      throw new Error(t('code.cli_config.missing_credentials', { tool: 'Poolside' }))
  },
  updateDraftConfig: (files) => files,
  async buildClearFiles() {
    const file = requireReadFile('poolside-settings', await readConfigFiles(this.targets))
    if (file.content === null) return []
    const document = parseYamlDocumentOrThrow(file.content)
    if (!document.hasIn(['agent_servers', POOLSIDE_GATEWAY_SERVER])) return []
    document.deleteIn(['agent_servers', POOLSIDE_GATEWAY_SERVER])
    if (document.getIn(['pool', 'default_agent_server']) === POOLSIDE_GATEWAY_SERVER)
      document.deleteIn(['pool', 'default_agent_server'])
    return [{ target: 'poolside-settings', content: document.toString() }]
  },
  extractConnection(files) {
    const config = parseYamlOrThrow(getDraftFile(files, 'poolside-settings')?.content ?? '')
    if (config.pool?.default_agent_server !== POOLSIDE_GATEWAY_SERVER) return null
    const server = config.agent_servers?.[POOLSIDE_GATEWAY_SERVER]
    return server
      ? {
          baseUrl: server.env?.POOLSIDE_STANDALONE_BASE_URL,
          apiKey: server.env?.POOLSIDE_API_KEY,
          model: server.default_config_options?.model
        }
      : null
  },
  extractConfig: () => ({})
}
