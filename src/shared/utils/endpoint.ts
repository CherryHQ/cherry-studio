import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

export function findEndpointType(value: string | null | undefined): EndpointType | undefined {
  return Object.values(ENDPOINT_TYPE).find((endpoint) => endpoint === value)
}

/** Recognized own endpoint keys, preserving the configuration's declared order. */
export function getConfiguredEndpointTypes(configs: Provider['endpointConfigs'] | null): EndpointType[] {
  const endpoints: EndpointType[] = []

  for (const key of Object.keys(configs ?? {})) {
    const endpoint = findEndpointType(key)

    if (endpoint !== undefined) endpoints.push(endpoint)
  }

  return endpoints
}
