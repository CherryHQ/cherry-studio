/**
 * MiniApp API Schema definitions
 *
 * System default apps are runtime-defined (not managed via API).
 * API only manages user preferences for default apps and full CRUD for custom apps.
 */

import type { MiniApp } from '@shared/data/types/miniApp'
import { MiniAppKindSchema, MiniAppRegionSchema, MiniAppStatusSchema } from '@shared/data/types/miniApp'
import * as z from 'zod'

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
 * Zod schema for batch reordering miniapps
 */
export const ReorderMiniAppsSchema = z.object({
  items: z.array(
    z.object({
      appId: z.string().regex(/^[A-Za-z0-9_-]+$/, 'appId can only contain letters, numbers, underscore, and hyphen'),
      sortOrder: z.number().int()
    })
  )
})
export type ReorderMiniAppsDto = z.infer<typeof ReorderMiniAppsSchema>

/**
 * Query parameters for listing miniapps
 */
export const ListMiniAppsQuerySchema = z.object({
  status: MiniAppStatusSchema.optional(),
  type: MiniAppKindSchema.optional()
})
export type ListMiniAppsQuery = z.infer<typeof ListMiniAppsQuerySchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

/**
 * MiniApp API Schema definitions
 * @public
 */
export interface MiniAppSchemas {
  /**
   * MiniApps collection endpoint
   * @example GET /mini-apps?status=enabled
   * @example POST /mini-apps { "appId": "my-app", "name": "My App", "url": "https://example.com" }
   * @example PATCH /mini-apps { "items": [{ "appId": "qwen", "sortOrder": 1 }] }
   *
   * TODO(I1): PATCH /mini-apps for batch reorder conflicts with the convention
   * "PATCH = partial update of one resource". Per the api-design-guidelines
   * decision tree, this should become PUT /mini-apps/order with body { items: [...] }.
   * Hold until a unified reorder spec is finalized.
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
    /** Batch reorder miniapps */
    PATCH: {
      body: ReorderMiniAppsDto
      response: void
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

  /**
   * Reset all builtin (default) app preferences to factory defaults.
   * Removes all DB preference rows for type='default', restoring original status/sortOrder.
   *
   * TODO(I1): DELETE is semantically a resource deletion, but this endpoint is
   * really a reset action. Consider POST /mini-apps/defaults/reset instead.
   * Hold until a unified reorder spec is finalized.
   *
   * @example DELETE /mini-apps/_actions/reset-defaults
   */
  '/mini-apps/_actions/reset-defaults': {
    /** Reset all default app preferences to builtin defaults */
    DELETE: {
      response: void
    }
  }
}
