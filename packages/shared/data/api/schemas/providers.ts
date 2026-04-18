/**
 * Provider API Schema definitions
 *
 * Contains all provider-related endpoints for CRUD operations.
 * DTO types are plain TypeScript interfaces — runtime validation
 * is performed by the ORM-derived Zod schema in userProvider.ts (main process).
 */

import type { EndpointType, Model } from '../../types/model'
import type {
  ApiFeatures,
  ApiKeyEntry,
  AuthConfig,
  EndpointConfig,
  Provider,
  ProviderSettings
} from '../../types/provider'
import type { EnrichModelsDto } from './models'

export interface ListProvidersQuery {
  /** Filter by enabled status */
  enabled?: boolean
  /** Filter by endpoint type */
  endpointType?: EndpointType
}

/** Shared editable fields between Create and Update DTOs */
interface ProviderMutableFields {
  /** Display name */
  name?: string
  /** Per-endpoint-type configuration (baseUrl, reasoningFormatType, modelsApiUrls) */
  endpointConfigs?: Partial<Record<EndpointType, EndpointConfig>>
  /** Default text generation endpoint (kebab-case EndpointType value, e.g. 'openai-chat-completions') */
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
      response: { keys: ApiKeyEntry[] }
    }
    /** Add an API key to a provider */
    POST: {
      params: { providerId: string }
      body: { key: string; label?: string }
      response: Provider
    }
  }

  /**
   * Registry models for a provider
   * GET: Get all registry preset models (read-only, no DB writes)
   * POST: Enrich raw SDK model entries against registry presets
   * @example GET /providers/openai/registry-models
   * @example POST /providers/openai/registry-models { "models": [{ "modelId": "gpt-4o" }] }
   */
  '/providers/:providerId/registry-models': {
    GET: {
      params: { providerId: string }
      response: Model[]
    }
    /** Resolve raw model IDs against registry presets */
    POST: {
      params: { providerId: string }
      body: EnrichModelsDto
      response: Model[]
    }
  }

  /**
   * Get full auth config for a provider (includes sensitive credentials).
   * SECURITY NOTE: Runtime Provider intentionally strips authConfig (only exposes authType).
   * This endpoint is for settings pages only — never call in chat hot path.
   * Acceptable in Electron (same-process IPC, no network exposure).
   * @example GET /providers/vertexai/auth-config
   */
  '/providers/:providerId/auth-config': {
    GET: {
      params: { providerId: string }
      response: AuthConfig | null
    }
  }

  /**
   * Delete a specific API key by ID
   * @example DELETE /providers/openai/api-keys/abc-123
   */
  '/providers/:providerId/api-keys/:keyId': {
    DELETE: {
      params: { providerId: string; keyId: string }
      response: Provider
    }
  }
}
