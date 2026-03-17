/**
 * Provider API Schema definitions
 *
 * Contains all provider-related endpoints for CRUD operations.
 * DTO types are plain TypeScript interfaces — runtime validation
 * is performed by the ORM-derived Zod schema in userProvider.ts (main process).
 */

import type { EndpointType } from '../../types/model'
import type { ApiFeatures, ApiKeyEntry, AuthConfig, Provider, ProviderSettings } from '../../types/provider'

export interface ListProvidersQuery {
  /** Filter by enabled status */
  enabled?: boolean
}

/** Shared editable fields between Create and Update DTOs */
interface ProviderMutableFields {
  /** Display name */
  name?: string
  /** Base URL mapping (EndpointType → baseURL) */
  baseUrls?: Partial<Record<EndpointType, string>>
  /** Model list API URLs */
  modelsApiUrls?: Record<string, string>
  /** Default text generation endpoint (numeric EndpointType enum value) */
  defaultChatEndpoint?: EndpointType
  /** API keys */
  apiKeys?: ApiKeyEntry[]
  /** Authentication configuration */
  authConfig?: AuthConfig
  /** API feature support */
  apiFeatures?: ApiFeatures
  /** Provider-specific settings */
  providerSettings?: Partial<ProviderSettings>
}

/** DTO for creating a new provider */
export interface CreateProviderDto extends ProviderMutableFields {
  /** User-defined unique ID (required) */
  providerId: string
  /** Associated preset provider ID */
  presetProviderId?: string
  /** Display name (required on create) */
  name: string
}

/** DTO for updating an existing provider — all mutable fields optional, plus status fields */
export interface UpdateProviderDto extends ProviderMutableFields {
  /** Whether this provider is enabled */
  isEnabled?: boolean
  /** Sort order in UI */
  sortOrder?: number
}

/**
 * Provider API Schema definitions
 */
export interface ProviderSchemas {
  /**
   * Providers collection endpoint
   * @example GET /providers?enabled=true
   * @example POST /providers { "providerId": "openai-main", "name": "OpenAI" }
   */
  '/providers': {
    /** List providers with optional filters */
    GET: {
      query: ListProvidersQuery
      response: Provider[]
    }
    /** Create a new provider */
    POST: {
      body: CreateProviderDto
      response: Provider
    }
  }

  /**
   * Individual provider endpoint
   * @example GET /providers/openai-main
   * @example PATCH /providers/openai-main { "isEnabled": false }
   * @example DELETE /providers/openai-main
   */
  '/providers/:providerId': {
    /** Get a provider by ID */
    GET: {
      params: { providerId: string }
      response: Provider
    }
    /** Update a provider */
    PATCH: {
      params: { providerId: string }
      body: UpdateProviderDto
      response: Provider
    }
    /** Delete a provider */
    DELETE: {
      params: { providerId: string }
      response: void
    }
  }

  /**
   * Get a rotated API key for a provider (round-robin across enabled keys)
   * @example GET /providers/openai-main/rotated-key
   */
  '/providers/:providerId/rotated-key': {
    GET: {
      params: { providerId: string }
      response: { apiKey: string }
    }
  }

  /**
   * Get all enabled API key values for a provider (for health check etc.)
   * @example GET /providers/openai-main/api-keys
   * @example POST /providers/openai-main/api-keys { "key": "sk-xxx", "label": "From URL import" }
   */
  '/providers/:providerId/api-keys': {
    GET: {
      params: { providerId: string }
      response: { keys: string[] }
    }
    /** Add an API key to a provider */
    POST: {
      params: { providerId: string }
      body: { key: string; label?: string }
      response: Provider
    }
  }
}
