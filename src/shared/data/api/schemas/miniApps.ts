/**
 * MiniApp API Schema definitions
 *
 * System default apps are runtime-defined (not managed via API).
 * API only manages user preferences for default apps and full CRUD for custom apps.
 */

import type { MiniApp } from '@shared/data/types/miniApp'
import { MiniAppStatusSchema } from '@shared/data/types/miniApp'
import * as z from 'zod'

import type { OrderEndpoints } from './_endpointHelpers'

/**
 * Permitted characters for a custom miniapp id. Exported so the v1→v2 migrator
 * can apply the same validation when transcribing legacy ids — keeping the
 * pattern in lock-step with `POST /mini-apps` prevents migrated rows that the
 * v2 API would refuse to recreate.
 */
export const MINI_APP_ID_REGEX = /^[A-Za-z0-9_-]+$/
export const MINI_APP_LOGO_MAX_LENGTH = 1024 * 1024
export const MINI_APP_ALLOWED_URL_PROTOCOLS = ['http:', 'https:', 'file:'] as const

/**
 * MiniApp logo input. Two forms:
 * - `string` — a preset icon id / url, stored inline on the row's `logo` column
 *   (capped at {@link MINI_APP_LOGO_MAX_LENGTH}).
 * - `Uint8Array` — a pre-encoded WebP upload, stored on disk as a `file_entry`
 *   and referenced by the row's `logoFileId`.
 */
const MiniAppLogoSchema = z.union([z.string().min(1).max(MINI_APP_LOGO_MAX_LENGTH), z.instanceof(Uint8Array)])
export const MiniAppUrlSchema = z.string().min(1).refine(isAllowedMiniAppUrl, {
  message: 'url must be a valid http, https, or file URL'
})

export function isAllowedMiniAppUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return MINI_APP_ALLOWED_URL_PROTOCOLS.includes(url.protocol as (typeof MINI_APP_ALLOWED_URL_PROTOCOLS)[number])
  } catch {
    return false
  }
}

/**
 * Zod schema for creating a new custom miniapp
 */
export const CreateMiniAppSchema = z.strictObject({
  appId: z.string().regex(MINI_APP_ID_REGEX, 'appId can only contain letters, numbers, underscore, and hyphen'),
  name: z.string().min(1),
  url: MiniAppUrlSchema,
  // string = preset icon id / url (stored inline in the SQLite row, capped at
  // 1 MiB to keep a runaway data URL from blowing up the row and SwR cache);
  // Uint8Array = pre-encoded WebP upload (stored on disk as a file_entry,
  // referenced by logoFileId).
  logo: MiniAppLogoSchema
})
export type CreateMiniAppDto = z.infer<typeof CreateMiniAppSchema>

/**
 * Zod schema for updating an existing miniapp.
 *
 * Preset rows may only update `status`; custom rows can also update their
 * user-editable fields. Reordering goes through the dedicated `/order`
 * endpoints, not this PATCH.
 */
export const UpdateMiniAppSchema = z.strictObject({
  status: MiniAppStatusSchema.optional(),
  name: z.string().min(1).optional(),
  url: MiniAppUrlSchema.optional(),
  logo: MiniAppLogoSchema.optional()
})
export type UpdateMiniAppDto = z.infer<typeof UpdateMiniAppSchema>

/**
 * Query parameters for listing miniApps
 */
export const ListMiniAppsQuerySchema = z.strictObject({
  status: MiniAppStatusSchema.optional()
})
export type ListMiniAppsQuery = z.infer<typeof ListMiniAppsQuerySchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

/**
 * MiniApp API Schema definitions
 * @public
 */
type MiniAppBaseSchemas = {
  /**
   * MiniApps collection endpoint
   * @example GET /mini-apps?status=enabled
   * @example POST /mini-apps { "appId": "my-app", "name": "My App", "url": "https://example.com" }
   */
  '/mini-apps': {
    /** Get all miniApps (optionally filtered by status/type) */
    GET: {
      query?: ListMiniAppsQuery
      response: MiniApp[]
    }
    /** Create a new miniapp (for custom apps or default app preference rows) */
    POST: {
      body: CreateMiniAppDto
      response: MiniApp
    }
  }

  /**
   * Individual miniapp endpoint
   * @example GET /mini-apps/qwen
   * @example PATCH /mini-apps/qwen { "status": "disabled" }
   * @example DELETE /mini-apps/qwen
   */
  '/mini-apps/:appId': {
    /** Get a miniapp by appId */
    GET: {
      params: { appId: string }
      response: MiniApp
    }
    /** Update a miniapp */
    PATCH: {
      params: { appId: string }
      body: UpdateMiniAppDto
      response: MiniApp
    }
    /** Delete a miniapp */
    DELETE: {
      params: { appId: string }
      response: void
    }
  }
}

/**
 * MiniApp API schema, including order endpoints (`PATCH /mini-apps/:id/order`,
 * `PATCH /mini-apps/order:batch`) per data-ordering-guide.md.
 * Reordering is partitioned by `status` (handled in the service layer).
 */
export type MiniAppSchemas = MiniAppBaseSchemas & OrderEndpoints<'/mini-apps'>
