/**
 * Provider API Schema definitions
 *
 * Contains all provider-related endpoints for CRUD operations.
 */

import * as z from 'zod'

import { FileEntryIdSchema } from '../../types/file'
import { ENDPOINT_TYPE, type EndpointType, objectValues } from '../../types/model'
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

/**
 * Backstop cap on the stored logo base64 string. The renderer already
 * normalizes uploads (`fileToAvatarDataUrl`): non-GIF → ≤128px, GIF kept but
 * capped at 256 KB raw (~341 KB base64). This is the server-side guard against
 * a hand-crafted oversized value; tighter than the mini-app 1 MiB cap because
 * the raw upload is now bounded.
 */
const LOGO_MAX_BASE64_BYTES = 512 * 1024

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
  /**
   * Custom logo preset/ref for a user-defined provider — a data URL, raw SVG,
   * remote URL, or an `icon:<providerId>` ref to a bundled brand icon (resolved
   * by `ProviderAvatarPrimitive`). Stored inline on the row's `logo` column,
   * size-capped (see {@link LOGO_MAX_BASE64_BYTES}). An uploaded image is NOT
   * sent here — the renderer pre-stores it and passes `logoFileId`.
   */
  logo: z.string().min(1).max(LOGO_MAX_BASE64_BYTES).optional(),
  /** Opaque file-entry id of a pre-stored uploaded logo; sets the row's `logoFileId`. */
  logoFileId: FileEntryIdSchema.optional(),
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

/**
 * DTO for updating an existing provider.
 *
 * Keep this pick-list default-free: PATCH schemas must not inherit create-time
 * defaults. If CreateProviderSchema adds defaults, move this to ProviderSchema.pick(...).
 */
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
  isEnabled: z.boolean().optional(),
  /**
   * Custom logo preset/ref. `null` clears it (falls back to the bundled icon);
   * a non-empty `string` sets a preset icon id / url; omitted leaves it
   * unchanged. `.min(1)` rejects `""` so `null` is the sole clear signal.
   */
  logo: z.string().min(1).max(LOGO_MAX_BASE64_BYTES).nullable().optional(),
  /** Opaque file-entry id of a pre-stored uploaded logo; `null` clears it. */
  logoFileId: FileEntryIdSchema.nullable().optional()
})
export type UpdateProviderDto = z.infer<typeof UpdateProviderSchema>

/** Query parameters for GET /providers */
export const ListProvidersQuerySchema = z.strictObject({
  /** Filter by enabled status */
  enabled: z.boolean().optional(),
  /** Filter by endpoint type (kebab-case `EndpointType` value) */
  endpointType: z.string().optional() as z.ZodOptional<z.ZodType<EndpointType>>
})
export type ListProvidersQuery = z.infer<typeof ListProvidersQuerySchema>

/** Query parameters for GET /providers/:providerId/api-keys */
export const ListProviderApiKeysQuerySchema = z.strictObject({
  /** When `true`, only enabled keys are returned. */
  enabled: z.boolean().optional()
})
export type ListProviderApiKeysQuery = z.infer<typeof ListProviderApiKeysQuerySchema>

/** POST /providers/:providerId/api-keys body */
export const AddProviderApiKeySchema = z.strictObject({
  key: z.string().trim().min(1),
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
  key: z.string().trim().min(1).optional(),
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
    /**
     * Add an API key to a provider.
     * Intentional: returns parent Provider so callers refresh the full provider in one round-trip
     * (api-design-guidelines.md § Handler Status Code Behavior treats POST→created entity as the default).
     */
    POST: {
      params: { providerId: string }
      body: AddProviderApiKeyDto
      response: Provider
    }
    /**
     * Replace API key entries for settings edits.
     * Intentional: returns parent Provider so callers refresh the full provider in one round-trip.
     */
    PUT: {
      params: { providerId: string }
      body: ReplaceProviderApiKeysDto
      response: Provider
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
    /**
     * Patch a specific API key entry.
     * Intentional: returns parent Provider so callers refresh the full provider in one round-trip.
     */
    PATCH: {
      params: { providerId: string; keyId: string }
      body: UpdateApiKeyDto
      response: Provider
    }
    /**
     * Delete a specific API key entry.
     * Intentional: returns parent Provider so callers refresh the full provider in one round-trip
     * (deviates from api-design-guidelines.md § Handler Status Code Behavior, which defaults DELETE→undefined/204).
     */
    DELETE: {
      params: { providerId: string; keyId: string }
      response: Provider
    }
  }
} & OrderEndpoints<'/providers'>
