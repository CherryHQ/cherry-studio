/**
 * Generic importer that coordinates fetching and transformation
 * Orchestrates the import process for provider model APIs
 */

import type { ModelConfig, ProviderConfig } from '../../../schemas'
import { BaseFetcher } from './base-fetcher'
import type { ITransformer } from './base-transformer'

export interface ImportResult {
  providerId: string
  models: ModelConfig[]
  fetchedAt: string
  count: number
}

export interface ImportOptions {
  /** API key for authentication */
  apiKey?: string
  /** Custom headers */
  headers?: Record<string, string>
  /** Auth header name (default: Authorization) */
  authHeaderName?: string
  /** Auth prefix (default: Bearer ) */
  authPrefix?: string
}

export class BaseImporter {
  private fetcher: BaseFetcher

  constructor() {
    this.fetcher = new BaseFetcher()
  }

  /**
   * Import models from a URL
   * @param providerId Provider identifier
   * @param url API endpoint URL
   * @param transformer Transformer instance
   * @param options Import options
   * @returns Import result with models
   */
  async importFromUrl(
    providerId: string,
    url: string,
    transformer: ITransformer,
    options: ImportOptions = {}
  ): Promise<ImportResult> {
    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers
    }

    // Add API key to headers if provided
    if (options.apiKey) {
      const headerName = options.authHeaderName || 'Authorization'
      const prefix = options.authPrefix || 'Bearer '
      headers[headerName] = `${prefix}${options.apiKey}`
    }

    // Fetch raw data
    const response = await this.fetcher.fetch({ url, headers })

    // Extract models array
    const rawModels = transformer.extractModels?.(response) || response.data || response

    // Transform to internal format
    const models = rawModels.map((m: unknown) => transformer.transform(m))

    return {
      providerId,
      models,
      fetchedAt: new Date().toISOString(),
      count: models.length
    }
  }

  /**
   * Import models from a provider's models API URL
   * @param provider Provider configuration
   * @param transformer Transformer instance
   * @param options Import options
   * @returns Import result with models
   */
  async importFromProvider(
    provider: ProviderConfig,
    transformer: ITransformer,
    options: ImportOptions = {}
  ): Promise<ImportResult> {
    if (!provider.modelsApiUrls?.default) {
      throw new Error(`Models API URL not configured for provider ${provider.id}`)
    }

    return this.importFromUrl(provider.id, provider.modelsApiUrls.default, transformer, options)
  }
}
