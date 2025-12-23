/**
 * Generic importer that coordinates fetching and transformation
 * Orchestrates the import process for provider model APIs
 */

import type { ModelConfig, ModelsApiEndpoint, ProviderConfig } from '../../../schemas'
import { BaseFetcher } from './base-fetcher'
import type { ITransformer } from './base-transformer'

export interface ImportResult {
  providerId: string
  endpointType: string
  models: ModelConfig[]
  fetchedAt: string
  count: number
}

export class BaseImporter {
  private fetcher: BaseFetcher

  constructor() {
    this.fetcher = new BaseFetcher()
  }

  /**
   * Import models from a single endpoint
   * @param providerId Provider identifier
   * @param endpoint Endpoint configuration
   * @param transformer Transformer instance
   * @param apiKey Optional API key for authentication
   * @returns Import result with models
   */
  async importFromEndpoint(
    providerId: string,
    endpoint: ModelsApiEndpoint,
    transformer: ITransformer,
    apiKey?: string
  ): Promise<ImportResult> {
    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }

    // Add API key to headers if provided
    if (apiKey) {
      if (endpoint.auth) {
        // Use custom auth configuration if specified
        const headerName = endpoint.auth.header_name || 'Authorization'
        const prefix = endpoint.auth.prefix || 'Bearer '
        headers[headerName] = `${prefix}${apiKey}`
      } else {
        // Default to standard Bearer token authentication
        headers['Authorization'] = `Bearer ${apiKey}`
      }
    }

    // Fetch raw data
    const response = await this.fetcher.fetch({
      url: endpoint.url,
      headers
    })

    // Extract models array
    const rawModels = transformer.extractModels?.(response) || response.data || response

    // Transform to internal format
    const models = rawModels.map((m) => transformer.transform(m))

    return {
      providerId,
      endpointType: endpoint.endpoint_type,
      models,
      fetchedAt: new Date().toISOString(),
      count: models.length
    }
  }

  /**
   * Import models from all endpoints of a provider
   * @param provider Provider configuration
   * @param transformerRegistry Transformer registry function
   * @param apiKey Optional API key for authentication
   * @returns Array of import results
   */
  async importFromProvider(
    provider: ProviderConfig,
    transformerRegistry: (name: string) => ITransformer,
    apiKey?: string
  ): Promise<ImportResult[]> {
    if (!provider.models_api?.enabled) {
      throw new Error(`Models API not enabled for provider ${provider.id}`)
    }

    const results: ImportResult[] = []

    for (const endpoint of provider.models_api.endpoints) {
      // Get transformer
      const transformerName = endpoint.transformer || provider.id
      const transformer = transformerRegistry(transformerName)

      // Import from endpoint
      const result = await this.importFromEndpoint(provider.id, endpoint, transformer, apiKey)

      results.push(result)
    }

    return results
  }
}
