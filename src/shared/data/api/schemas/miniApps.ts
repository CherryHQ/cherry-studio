/**
 * MiniApp API Schema definitions
 *
 * System default apps are runtime-defined (not managed via API).
 * API only manages user preferences for default apps and full CRUD for custom apps.
 */

import type { MiniApp } from '@shared/data/types/miniApp'
import { MiniAppRegionSchema, MiniAppStatusSchema } from '@shared/data/types/miniApp'
import * as z from 'zod'

import type { OrderEndpoints } from './_endpointHelpers'

/**
 * Permitted characters for a custom miniapp id. Exported so the v1→v2 migrator
 * can apply the same validation when transcribing legacy ids — keeping the
 * pattern in lock-step with `POST /mini-apps` prevents migrated rows that the
 * v2 API would refuse to recreate.
 */
export const MINI_APP_ID_REGEX = /^[A-Za-z0-9_-]+$/

/**
 * Zod schema for creating a new custom miniapp
 */
export const CreateMiniAppSchema = z.strictObject({
  appId: z.string().regex(MINI_APP_ID_REGEX, 'appId can only contain letters, numbers, underscore, and hyphen'),
  name: z.string().min(1),
  url: z.string().min(1),
  // Logos are stored inline (data URLs / SVG / remote URLs) and end up in the
  // SQLite row alongside the app metadata. Cap at 1 MiB to keep a runaway data
  // URL from blowing up the row size and the SwR cache value.
  logo: z
    .string()
    .min(1)
    .max(1024 * 1024),
  bordered: z.boolean(),
  supportedRegions: z.array(MiniAppRegionSchema).min(1),
  background: z.string().nullable().optional(),
  configuration: z.unknown().nullable().optional()
})
export type CreateMiniAppDto = z.infer<typeof CreateMiniAppSchema>

/**
 * Zod schema for updating an existing miniapp.
 *
 * Only `status` (enabled/disabled/pinned) is mutable. Preset display fields
 * (name/url/logo/...) are owned by the seeder and have no edit UI. Reordering
 * goes through the dedicated `/order` endpoints, not this PATCH.
 */
export const UpdateMiniAppSchema = z.strictObject({
  status: MiniAppStatusSchema.optional()
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
