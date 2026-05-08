/**
 * Provider API Schema definitions
 *
 * Contains all provider-related endpoints for CRUD operations.
 */

import * as z from 'zod'

import { ENDPOINT_TYPE, type EndpointType, type Model, objectValues } from '../../types/model'
import {
  ApiFeaturesSchema,
  type ApiKeyEntry,
  ApiKeyEntrySchema,
  type AuthConfig,
  AuthConfigSchema,
  type EndpointConfig,
  EndpointConfigSchema,
  type Provider,
  type ProviderSettings,
  ProviderSettingsSchema,
  type ProviderWebsites
} from '../../types/provider'
import type { OrderEndpoints } from './_endpointHelpers'
import type { EnrichModelsDto } from './models'

// ============================================================================
// Field atoms
// ============================================================================

/**
 * Per-endpoint-type configuration map. Keys are kebab-case `EndpointType`
 * strings; we keep the TS cast so `endpointConfigs` stays typed without
 * reaching for the full `provider-registry` enum in this file.
 */
const EndpointTypeSchema = z.enum(objectValues(ENDPOINT_TYPE))

const ProviderEndpointConfigsSchema = z.record(EndpointTypeSchema, EndpointConfigSchema) as z.ZodType<
  Partial<Record<EndpointType, EndpointConfig>>
>

/**
 * Provider-settings is a loose bag today (e.g. OAuth tokens, provider-specific
 * knobs); keep `Partial<ProviderSettings>` as the DTO shape for parity with
 * the existing API surface.
 */
const ProviderSettingsPartialSchema = ProviderSettingsSchema.partial()

// ============================================================================
// DTOs
// ============================================================================

/** DTO for creating a new provider */
export const CreateProviderSchema = z.strictObject({
  /** User-defined unique ID (required) */
  providerId: z.string().min(1),
  /** Associated preset provider ID */
  presetProviderId: z.string().optional(),
  /** Display name (required on create) */
  name: z.string().min(1),
  /** Per-endpoint-type configuration */
  endpointConfigs: ProviderEndpointConfigsSchema.optional(),
  /** Default text generation endpoint (kebab-case `EndpointType` value) */
  defaultChatEndpoint: EndpointTypeSchema.optional(),
  /** API keys */
  apiKeys: z.array(ApiKeyEntrySchema).optional(),
  /** Authentication configuration */
  authConfig: AuthConfigSchema.optional(),
  /** API feature support */
  apiFeatures: ApiFeaturesSchema.optional(),
  /** Provider-specific settings */
  providerSettings: ProviderSettingsPartialSchema.optional()
})
export type CreateProviderDto = z.infer<typeof CreateProviderSchema>

/** DTO for updating an existing provider — all mutable fields optional, plus status fields */
export const UpdateProviderSchema = CreateProviderSchema.partial()
  .omit({ providerId: true, presetProviderId: true })
  .extend({
    /** Whether this provider is enabled */
    isEnabled: z.boolean().optional()
  })
export type UpdateProviderDto = z.infer<typeof UpdateProviderSchema>

/** Query parameters for GET /providers */
export const ListProvidersQuerySchema = z.strictObject({
  /** Filter by enabled status */
  enabled: z.boolean().optional()
})
export type ListProvidersQuery = z.infer<typeof ListProvidersQuerySchema>

/** POST /providers/:providerId/api-keys body */
export const AddProviderApiKeySchema = z.strictObject({
  key: z.string().min(1),
  label: z.string().optional()
})
export type AddProviderApiKeyDto = z.infer<typeof AddProviderApiKeySchema>

/** PATCH /providers/:providerId/api-keys/:keyId body */
export const UpdateApiKeySchema = z.strictObject({
  key: z.string().min(1).optional(),
  label: z.string().optional(),
  isEnabled: z.boolean().optional()
})
export type UpdateApiKeyDto = z.infer<typeof UpdateApiKeySchema>

export interface ProviderPresetMetadata {
  websites?: ProviderWebsites
}

// Re-exported for handler-side re-use
export type { ApiKeyEntry, AuthConfig, EndpointConfig, ProviderSettings }

/**
 * Provider API Schema definitions
 */
export type ProviderSchemas = {
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
   * Get all API key values for a provider settings editor.
   * Consumers that only need enabled keys should filter by `isEnabled` or use `/rotated-key`.
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
      body: AddProviderApiKeyDto
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
   * Read-only preset metadata for a provider.
   * Returns registry-backed display metadata without widening the runtime
   * Provider contract.
   */
  '/providers/:providerId/preset-metadata': {
    GET: {
      params: { providerId: string }
      response: ProviderPresetMetadata
    }
  }

  /**
   * Manage a specific API key by ID
   * @example PATCH /providers/openai/api-keys/abc-123 { "label": "Primary" }
   * @example DELETE /providers/openai/api-keys/abc-123
   */
  '/providers/:providerId/api-keys/:keyId': {
    PATCH: {
      params: { providerId: string; keyId: string }
      body: UpdateApiKeyDto
      response: Provider
    }
    DELETE: {
      params: { providerId: string; keyId: string }
      response: Provider
    }
  }
} & OrderEndpoints<'/providers'>
