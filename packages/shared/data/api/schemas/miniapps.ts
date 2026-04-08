/**
 * MiniApp API Schema definitions
 *
 * System default apps are runtime-defined (not managed via API).
 * API only manages user preferences for default apps and full CRUD for custom apps.
 */

import type { MiniApp } from '@shared/data/types/miniapp'
import * as z from 'zod'

import type { OffsetPaginationResponse } from '../apiTypes'

// ============================================================================
// Zod Schemas for runtime validation
// ============================================================================

const MiniAppStatusSchema = z.enum(['enabled', 'disabled', 'pinned'])
const MiniAppTypeSchema = z.enum(['default', 'custom'])
const MiniAppRegionSchema = z.enum(['CN', 'Global'])

/**
 * Zod schema for creating a new custom miniapp
 */
export const CreateMiniappSchema = z.object({
  appId: z.string().min(1),
  name: z.string().min(1),
  url: z.string().min(1),
  logo: z.string().min(1),
  bordered: z.boolean(),
  supportedRegions: z.array(MiniAppRegionSchema).min(1),
  background: z.string().nullable().optional(),
  configuration: z.unknown().nullable().optional()
})
export type CreateMiniappDto = z.infer<typeof CreateMiniappSchema>

/**
 * Zod schema for updating an existing miniapp
 */
export const UpdateMiniappSchema = z.object({
  name: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  logo: z.string().optional(),
  status: MiniAppStatusSchema.optional(),
  bordered: z.boolean().optional(),
  background: z.string().nullable().optional(),
  supportedRegions: z.array(MiniAppRegionSchema).optional(),
  configuration: z.unknown().nullable().optional()
})
export type UpdateMiniappDto = z.infer<typeof UpdateMiniappSchema>

/**
 * Zod schema for batch reordering miniapps
 */
export const ReorderMiniappsSchema = z.object({
  items: z.array(
    z.object({
      appId: z.string().min(1),
      sortOrder: z.number().int()
    })
  )
})
export type ReorderMiniappsDto = z.infer<typeof ReorderMiniappsSchema>

/**
 * Query parameters for listing miniapps
 */
export const ListMiniappsQuerySchema = z.object({
  status: MiniAppStatusSchema.optional(),
  type: MiniAppTypeSchema.optional()
})
export type ListMiniappsQuery = z.infer<typeof ListMiniappsQuerySchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

/**
 * MiniApp API Schema definitions
 */
export interface MiniappSchemas {
  /**
   * Miniapps collection endpoint
   * @example GET /miniapps?status=enabled
   * @example POST /miniapps { "appId": "my-app", "name": "My App", "url": "https://example.com" }
   * @example PATCH /miniapps { "items": [{ "appId": "qwen", "sortOrder": 1 }] }
   */
  '/miniapps': {
    /** Get all miniapps (optionally filtered by status/type) */
    GET: {
      query?: ListMiniappsQuery
      response: OffsetPaginationResponse<MiniApp>
    }
    /** Create a new miniapp (for custom apps or default app preference rows) */
    POST: {
      body: CreateMiniappDto
      response: MiniApp
    }
    /** Batch reorder miniapps */
    PATCH: {
      body: ReorderMiniappsDto
      response: void
    }
  }

  /**
   * Individual miniapp endpoint
   * @example GET /miniapps/qwen
   * @example PATCH /miniapps/qwen { "status": "disabled" }
   * @example DELETE /miniapps/qwen
   */
  '/miniapps/:id': {
    /** Get a miniapp by appId */
    GET: {
      params: { id: string }
      response: MiniApp
    }
    /** Update a miniapp */
    PATCH: {
      params: { id: string }
      body: UpdateMiniappDto
      response: MiniApp
    }
    /** Delete a miniapp */
    DELETE: {
      params: { id: string }
      response: void
    }
  }

  /**
   * Reset all builtin (default) app preferences to factory defaults.
   * Removes all DB preference rows for type='default', restoring original status/sortOrder.
   * @example DELETE /miniapps/defaults
   */
  '/miniapps/defaults': {
    /** Reset all default app preferences to builtin defaults */
    DELETE: {
      response: void
    }
  }
}
