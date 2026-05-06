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
 * Zod schema for creating a new custom miniapp
 */
export const CreateMiniAppSchema = z.object({
  appId: z.string().regex(/^[A-Za-z0-9_-]+$/, 'appId can only contain letters, numbers, underscore, and hyphen'),
  name: z.string().min(1),
  url: z.string().min(1),
  logo: z.string().min(1),
  bordered: z.boolean(),
  supportedRegions: z.array(MiniAppRegionSchema).min(1),
  background: z.string().nullable().optional(),
  configuration: z.unknown().nullable().optional()
})
export type CreateMiniAppDto = z.infer<typeof CreateMiniAppSchema>

/**
 * Zod schema for updating an existing miniapp
 */
export const UpdateMiniAppSchema = z.object({
  name: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  logo: z.string().optional(),
  status: MiniAppStatusSchema.optional(),
  bordered: z.boolean().optional(),
  background: z.string().nullable().optional(),
  supportedRegions: z.array(MiniAppRegionSchema).optional(),
  configuration: z.unknown().nullable().optional()
})
export type UpdateMiniAppDto = z.infer<typeof UpdateMiniAppSchema>

/**
 * Query parameters for listing miniapps
 */
export const ListMiniAppsQuerySchema = z.object({
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
    /** Get all miniapps (optionally filtered by status/type) */
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
