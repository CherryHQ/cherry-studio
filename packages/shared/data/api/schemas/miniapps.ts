/**
 * MiniApp API Schema definitions
 *
 * Contains all miniapp-related endpoints for CRUD operations and status management.
 */

import type { MiniApp } from '@shared/data/types/miniapp'

// ============================================================================
// DTOs
// ============================================================================

/**
 * DTO for creating a new miniapp
 */
export interface CreateMiniappDto {
  /** App identifier */
  appId: string
  /** Display name */
  name: string
  /** App URL */
  url: string
  /** Logo */
  logo?: string
  /** App type: default or custom */
  type?: 'default' | 'custom'
  /** User status for this app */
  status?: 'enabled' | 'disabled' | 'pinned'
  /** Whether the app shows a border */
  bordered?: boolean
  /** Background color */
  background?: string
  /** Region availability */
  supportedRegions?: ('CN' | 'Global')[]
  /** Custom configuration */
  configuration?: Record<string, any>
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
  configuration?: Record<string, any>
}

/**
 * DTO for batch reordering miniapps
 */
export interface ReorderMiniappsDto {
  items: Array<{ id: string; sortOrder: number }>
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
   * @example POST /miniapps { "appId": "qwen", "name": "Qwen", "url": "https://qwen.ai" }
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
    /** Create a new miniapp (for custom apps) */
    POST: {
      body: CreateMiniappDto
      response: MiniApp
    }
  }

  /**
   * Batch reorder endpoint
   * @example PATCH /miniapps/reorder { "items": [{ "id": "abc", "sortOrder": 1 }] }
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
   * @example PATCH /miniapps/qwen { "name": "Qwen" }
   * @example DELETE /miniapps/qwen
   */
  '/miniapps/:id': {
    /** Get a miniapp by ID */
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
   * Status sub-resource endpoint
   * High-frequency operation for toggling app status
   * @example PUT /miniapps/abc123/status { "status": "pinned" }
   */
  '/miniapps/:id/status': {
    /** Set the status for a miniapp */
    PUT: {
      params: { id: string }
      body: SetMiniappStatusDto
      response: StatusUpdateResponse
    }
  }
}
