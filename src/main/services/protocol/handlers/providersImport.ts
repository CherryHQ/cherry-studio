import { application } from '@application'
import { loggerService } from '@logger'

const logger = loggerService.withContext('ProtocolService:providersImport')

export function parseProvidersImportData(data: string) {
  try {
    const result = JSON.parse(
      Buffer.from(data, 'base64').toString('utf-8').replaceAll("'", '"').replaceAll('(', '').replaceAll(')', '')
    )

    return JSON.stringify(result)
  } catch (error) {
    logger.error('parseProvidersImportData error:', error as Error)
    return null
  }
}

export async function handleProvidersProtocolUrl(url: URL) {
  switch (url.pathname) {
    case '/api-keys': {
      // jsonConfig example:
      // {
      //   "id": "tokenflux",
      //   "baseUrl": "https://tokenflux.ai/v1",
      //   "apiKey": "sk-xxxx",
      //   "name": "TokenFlux", // optional
      //   "type": "openai" // optional
      // }
      // cherrystudio://providers/api-keys?v=1&data={base64Encode(JSON.stringify(jsonConfig))}

      // replace + and / to _ and - because + and / are processed by URLSearchParams
      const processedSearch = url.search.replaceAll('+', '_').replaceAll('/', '-')
      const params = new URLSearchParams(processedSearch)
      const data = parseProvidersImportData(params.get('data')?.replaceAll('_', '+').replaceAll('-', '/') || '')

      if (!data) {
        logger.error('handleProvidersProtocolUrl data is null or invalid')
        return
      }

      const version = params.get('v')
      if (version == '1') {
        // TODO: handle different version
        logger.debug('handleProvidersProtocolUrl', { data, version })
      }

      application.get('SettingsWindowService').open(`/settings/provider?addProviderData=${encodeURIComponent(data)}`)
      break
    }
    default:
      logger.error(`Unknown MCP protocol URL: ${url}`)
      break
  }
}
