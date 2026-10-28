import { useTranslation } from 'react-i18next'

import { resolveEndpointConnection } from '@cherrystudio/provider-registry'
import type { EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { redactUrlParams } from '@shared/utils/redaction'

export function ModelConnectionDetails({ provider, endpoints }: { provider: Provider; endpoints: EndpointType[] }) {
  const { t } = useTranslation()
  const effectiveEndpoints = endpoints.length
    ? endpoints
    : provider.defaultChatEndpoint
      ? [provider.defaultChatEndpoint]
      : []
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {effectiveEndpoints.map((endpoint) => {
        const connection = resolveEndpointConnection(provider, endpoint)
        const adapter = provider.endpointConfigs?.[endpoint]?.adapterFamily
        // These SDKs derive their default host from region or project/location.
        if (!connection && ['google-vertex', 'google-vertex-anthropic', 'bedrock'].includes(adapter ?? '')) {
          return null
        }
        return connection ? (
          <div key={endpoint} className="break-all">
            <code>
              {endpoint} → {connection.source}
            </code>
            <div>{redactUrlParams(connection.baseUrl)}</div>
          </div>
        ) : (
          <div key={endpoint} role="alert" className="text-warning">
            {t('settings.models.defaults.missing_connection', { endpoint })}
          </div>
        )
      })}
    </div>
  )
}
