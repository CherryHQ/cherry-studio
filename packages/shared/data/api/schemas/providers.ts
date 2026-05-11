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
  ProviderSettingsSchema
} from '../../types/provider'
import type { OrderEndpoints } from './_endpointHelpers'

// ============================================================================
// Field atoms
// ============================================================================

/**
 * Per-endpoint-type configuration map. Keys are kebab-case `EndpointType`
 * strings; we keep the TS cast so `endpointConfigs` stays typed without
 * reaching for the full `provider-registry` enum in this file.
 */
const EndpointTypeSchema = z.enum(objectValues(ENDPOINT_TYPE))

// `z.record(enum, value)` in zod 4 requires every enum key to be present —
// `partialRecord` keeps keys optional so PATCH bodies can carry just the
// endpoints actually configured (e.g. cherryin only sets `openai-chat-completions`
// and `anthropic-messages`, not the full EndpointType set).
const ProviderEndpointConfigsSchema = z.partialRecord(EndpointTypeSchema, EndpointConfigSchema) as z.ZodType<
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
const ProviderMutableFieldsSchema = CreateProviderSchema.pick({
  name: true,
  endpointConfigs: true,
  defaultChatEndpoint: true,
  authConfig: true,
  apiFeatures: true,
  providerSettings: true
})

export const UpdateProviderSchema = ProviderMutableFieldsSchema.partial().extend({
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

/** Query parameters for GET /providers/:providerId/api-keys */
export const ListProviderApiKeysQuerySchema = z.strictObject({
  /** When `true`, only enabled keys are returned. */
  enabled: z.boolean().optional()
})
export type ListProviderApiKeysQuery = z.infer<typeof ListProviderApiKeysQuerySchema>

/** Query parameters for resolving raw SDK model IDs against registry presets */
export const ResolveProviderModelsQuerySchema = z.strictObject({
  /** Raw model IDs from SDK listModels(), repeated as ?ids=a&ids=b or provided as an array by IPC callers. */
  ids: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)])
})
export type ResolveProviderModelsQuery = z.infer<typeof ResolveProviderModelsQuerySchema>

/** POST /providers/:providerId/api-keys body */
export const AddProviderApiKeySchema = z.strictObject({
  key: z.string().min(1),
  label: z.string().optional()
})
export type AddProviderApiKeyDto = z.infer<typeof AddProviderApiKeySchema>

/** PUT /providers/:providerId/api-keys body */
export const ReplaceProviderApiKeysSchema = z.strictObject({
  keys: z.array(ApiKeyEntrySchema)
})
export type ReplaceProviderApiKeysDto = z.infer<typeof ReplaceProviderApiKeysSchema>

/** PATCH /providers/:providerId/api-keys/:keyId body */
export const UpdateApiKeySchema = z.strictObject({
  key: z.string().min(1).optional(),
  label: z.string().optional(),
  isEnabled: z.boolean().optional()
})
export type UpdateApiKeyDto = z.infer<typeof UpdateApiKeySchema>

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
   * Get API key values for a provider settings editor.
   * Pass `?enabled=true` to get only enabled keys (e.g. for runtime / rotation
   * consumers); omit it to get all keys (for the management UI that needs to
   * preserve disabled entries).
   * @example GET /providers/openai-main/api-keys
   * @example GET /providers/openai-main/api-keys?enabled=true
   * @example POST /providers/openai-main/api-keys { "key": "sk-xxx", "label": "From URL import" }
   */
  '/providers/:providerId/api-keys': {
    GET: {
      params: { providerId: string }
      query: ListProviderApiKeysQuery
      response: { keys: ApiKeyEntry[] }
    }
    /** Add an API key to a provider */
    POST: {
      params: { providerId: string }
      body: AddProviderApiKeyDto
      response: Provider
    }
    /** Replace API key entries for settings edits */
    PUT: {
      params: { providerId: string }
      body: ReplaceProviderApiKeysDto
      response: Provider
    }
  }

  /**
   * Statelessly resolve raw SDK model IDs against registry presets.
   * @example GET /providers/openai/models:resolve?ids=gpt-4o&ids=o3
   */
  '/providers/:providerId/models:resolve': {
    /** Resolve raw model IDs against registry presets */
    GET: {
      params: { providerId: string }
      query: ResolveProviderModelsQuery
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
