import { loggerService } from '@logger'
import { openSettingsInMainWindow } from '@main/services/mainWindowNavigation'

const logger = loggerService.withContext('ProtocolService:providersImport')

export function parseProvidersImportData(data: string) {
  try {
    const decoded = Buffer.from(data, 'base64').toString('utf-8')
    let result: unknown

    try {
      result = JSON.parse(decoded)
    } catch {
      result = JSON.parse(decoded.replaceAll("'", '"').replaceAll('(', '').replaceAll(')', ''))
    }

    return JSON.stringify(result)
  } catch (error) {
    logger.error('parseProvidersImportData error:', error as Error)
    return null
  }
}

// URLSearchParams decodes `+` as a space, so swap the base64 alphabet around parsing.
function readImportDataParam(url: URL): { params: URLSearchParams; data: string | null } {
  const params = new URLSearchParams(url.search.replaceAll('+', '_').replaceAll('/', '-'))
  const data = parseProvidersImportData(params.get('data')?.replaceAll('_', '+').replaceAll('-', '/') || '')
  return { params, data }
}

export async function handleProvidersProtocolUrl(url: URL) {
  switch (url.pathname) {
    case '/api-keys': {
      // jsonConfig example:
      // {
      //   "id": "custom-openai",
      //   "baseUrl": "https://api.example.com/v1",
      //   "apiKey": "sk-xxxx",
      //   "name": "Custom OpenAI", // optional
      //   "type": "openai" // optional
      // }
      // cherrystudio://providers/api-keys?v=1&data={base64Encode(JSON.stringify(jsonConfig))}
      const { params, data } = readImportDataParam(url)

      if (!data) {
        logger.error('handleProvidersProtocolUrl data is null or invalid')
        return
      }

      const version = params.get('v')
      if (version == '1') {
        // TODO: handle different version
        logger.debug('handleProvidersProtocolUrl', { data, version })
      }

      openSettingsInMainWindow(`/settings/provider?addProviderData=${encodeURIComponent(data)}`)
      break
    }
    case '/vertex-google': {
      // cherrystudio://providers/vertex-google?data={base64Encode(JSON.stringify({ project, location, clientId, clientSecret }))}
      // Any `v` param is ignored; the renderer confirms the org-provisioned setup before saving.
      const { data } = readImportDataParam(url)
      if (!data) {
        logger.error('Vertex Google setup link data is missing or invalid')
        return
      }
      openSettingsInMainWindow(`/settings/provider?vertexGoogleSetup=${encodeURIComponent(data)}`)
      break
    }
    default:
      logger.error(`Unknown MCP protocol URL: ${url}`)
      break
  }
}
