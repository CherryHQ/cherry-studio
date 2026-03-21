/**
 * MiniApp API Schema definitions
 *
 * System default apps are runtime-defined (not managed via API).
 * API only manages user preferences for default apps and full CRUD for custom apps.
 */

import type { MiniApp } from '@shared/data/types/miniapp'

// ============================================================================
// DTOs
// ============================================================================

/**
 * DTO for creating a new custom miniapp
 * Note: User-created apps are always type 'custom', cannot create type 'default'
 */
export interface CreateMiniappDto {
  /** App identifier */
  appId: string
  /** Display name */
  name: string
  /** App URL */
  url: string
  /** Logo URL or base64 */
  logo?: string
  /** Whether the app shows a border */
  bordered?: boolean
  /** Background color */
  background?: string
  /** Region availability */
  supportedRegions?: ('CN' | 'Global')[]
  /** Custom configuration */
  configuration?: unknown
}

/**
 * DTO for updating an existing miniapp
 */
export interface UpdateMiniappDto {
  /** Updated display name */
  name?: string
  /** Updated app URL */
  url?: string
  /** Updated logo */
  logo?: string
  /** Updated status */
  status?: 'enabled' | 'disabled' | 'pinned'
  /** Updated border setting */
  bordered?: boolean
  /** Updated background color */
  background?: string
  /** Updated region availability */
  supportedRegions?: ('CN' | 'Global')[]
  /** Updated custom configuration */
  configuration?: unknown
}

/**
 * DTO for batch reordering miniapps
 */
export interface ReorderMiniappsDto {
  items: Array<{ appId: string; sortOrder: number }>
}

/**
 * DTO for setting miniapp status
 */
export interface SetMiniappStatusDto {
  status: 'enabled' | 'disabled' | 'pinned'
}

/**
 * Response for status update
 */
export interface StatusUpdateResponse {
  miniapp: MiniApp
}

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
   */
  '/miniapps': {
    /** Get all miniapps (optionally filtered by status/type) */
    GET: {
      query?: {
        status?: 'enabled' | 'disabled' | 'pinned'
        type?: 'default' | 'custom'
      }
      response: MiniApp[]
    }
    /** Create a new miniapp (for custom apps or default app preference rows) */
    POST: {
      body: CreateMiniappDto
      response: MiniApp
    }
  }

  /**
   * Batch reorder endpoint
   * @example PATCH /miniapps/reorder { "items": [{ "appId": "qwen", "sortOrder": 1 }] }
   */
  '/miniapps/reorder': {
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
  '/miniapps/:appId': {
    /** Get a miniapp by appId */
    GET: {
      params: { appId: string }
      response: MiniApp
    }
    /** Update a miniapp */
    PATCH: {
      params: { appId: string }
      body: UpdateMiniappDto
      response: MiniApp
    }
    /** Delete a miniapp */
    DELETE: {
      params: { appId: string }
      response: void
    }
  }

  /**
   * Status sub-resource endpoint
   * High-frequency operation for toggling app status
   * @example PUT /miniapps/qwen/status { "status": "pinned" }
   */
  '/miniapps/:appId/status': {
    /** Set the status for a miniapp */
    PUT: {
      params: { appId: string }
      body: SetMiniappStatusDto
      response: StatusUpdateResponse
    }
  }
}
