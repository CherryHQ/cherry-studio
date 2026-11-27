import {
  clearPoolsideGateway,
  readPoolsideGateway,
  writePoolsideGateway
} from '@cherrystudio/agent-runtime-poolside-acp'
import { poolsideCli } from '@cherrystudio/agent-runtime-poolside-acp/cli'
import { formatApiHost } from '@shared/utils/api'

import type { CliConfigAdapter } from './adapters'
import { getDraftFile, makeDraftFile, readAndParseDraftFile, readConfigFilesForDraft } from './draftFiles'
import { parseYamlDocumentOrThrow, parseYamlOrThrow, CliConfigError, requireReadFile } from './file'
import { getCliConfigTargets } from './targets'
import { stringValue } from './values'

export const poolsideAdapter: CliConfigAdapter = {
  targets: getCliConfigTargets(poolsideCli.modelConfig.tool),
  providerBaseUrls: (provider) => {
    const url = provider.endpointConfigs?.[poolsideCli.modelEndpoints[0]]?.baseUrl
    return url ? [formatApiHost(url)] : []
  },
  sanitize: () => ({}),
  async buildDraft(args, context, reader) {
    this.assertCredentials(context)
    const read = await readConfigFilesForDraft(reader, this.targets, args.files)
    const document = readAndParseDraftFile('poolside-settings', parseYamlDocumentOrThrow, args.files, read)
    writePoolsideGateway(document, context.apiKey, this.providerBaseUrls(context.provider)[0], context.model)
    return [makeDraftFile('poolside-settings', document.toString(), read)]
  },
  assertCredentials(context) {
    if (!context.apiKey || !this.providerBaseUrls(context.provider).length)
      throw new CliConfigError('code.cli_config.missing_credentials', { tool: 'Poolside' })
  },
  updateDraftConfig: (files) => files,
  async buildClearFiles(reader) {
    const file = requireReadFile('poolside-settings', await reader(this.targets))
    if (file.content === null) return []
    const document = parseYamlDocumentOrThrow(file.content)
    if (!clearPoolsideGateway(document)) return []
    return [{ target: 'poolside-settings', content: document.toString() }]
  },
  extractConnection(files) {
    const config = parseYamlOrThrow(getDraftFile(files, 'poolside-settings')?.content ?? '')
    const connection = readPoolsideGateway(config)
    return connection
      ? {
          baseUrl: stringValue(connection.baseUrl),
          apiKey: stringValue(connection.apiKey),
          model: stringValue(connection.model)
        }
      : null
  },
  extractConfig: () => ({})
}
