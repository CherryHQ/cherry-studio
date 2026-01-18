/**
 * WebSearch Provider API Schema definitions
 *
 * Contains all websearch provider-related endpoints for CRUD operations and connection testing.
 */

import type { OffsetPaginationParams, OffsetPaginationResponse } from '../apiTypes'

// ============================================================================
// Entity Types
// ============================================================================

/**
 * Provider type distinguishing between API-based and local browser-based providers
 */
export type WebSearchProviderType = 'api' | 'local'

/**
 * WebSearch provider entity
 */
export interface WebSearchProvider {
  /** Unique provider identifier (user-specified, e.g., 'tavily', 'searxng') */
  id: string
  /** Display name */
  name: string
  /** Provider type: 'api' for API-based, 'local' for browser-based */
  type: WebSearchProviderType
  /** API key (for API type providers) */
  apiKey: string | null
  /** API host URL or URL template with %s placeholder (for local type) */
  apiHost: string | null
  /** Search engines list (for SearxNG) */
  engines: string[] | null
  /** Whether to use browser for fetching (for local type) */
  usingBrowser: boolean
  /** HTTP Basic Auth username (for SearxNG) */
  basicAuthUsername: string | null
  /** HTTP Basic Auth password (for SearxNG) */
  basicAuthPassword: string | null
  /** Creation timestamp (Unix ms) */
  createdAt: number
  /** Last update timestamp (Unix ms) */
  updatedAt: number
}

// ============================================================================
// DTOs
// ============================================================================

/**
 * DTO for creating a new websearch provider
 */
export interface CreateWebSearchProviderDto {
  /** User-specified unique ID */
  id: string
  /** Display name */
  name: string
  /** Provider type */
  type: WebSearchProviderType
  /** API key (for API type) */
  apiKey?: string | null
  /** API host URL or URL template */
  apiHost?: string | null
  /** Search engines list */
  engines?: string[] | null
  /** Whether to use browser for fetching */
  usingBrowser?: boolean
  /** HTTP Basic Auth username */
  basicAuthUsername?: string | null
  /** HTTP Basic Auth password */
  basicAuthPassword?: string | null
}

/**
 * DTO for updating an existing websearch provider
 */
export interface UpdateWebSearchProviderDto {
  /** Updated display name */
  name?: string
  /** Updated provider type */
  type?: WebSearchProviderType
  /** Updated API key */
  apiKey?: string | null
  /** Updated API host URL */
  apiHost?: string | null
  /** Updated search engines list */
  engines?: string[] | null
  /** Updated browser usage flag */
  usingBrowser?: boolean
  /** Updated HTTP Basic Auth username */
  basicAuthUsername?: string | null
  /** Updated HTTP Basic Auth password */
  basicAuthPassword?: string | null
}

// ============================================================================
// Response Types
// ============================================================================

/**
 * Response for provider connection test
 */
export interface TestProviderResponse {
  /** Whether the connection test succeeded */
  success: boolean
  /** Human-readable result message */
  message: string
  /** Response latency in milliseconds (if successful) */
  latencyMs?: number
}

// ============================================================================
// API Schema Definitions
// ============================================================================

/**
 * WebSearch Provider API Schema definitions
 */
export interface WebSearchProviderSchemas {
  /**
   * Providers collection endpoint
   * @example GET /websearch-providers?page=1&limit=20
   */
  '/websearch-providers': {
    /** List all providers with pagination */
    GET: {
      query?: OffsetPaginationParams
      response: OffsetPaginationResponse<WebSearchProvider>
    }
  }

  /**
   * Individual provider endpoint
   * @example GET /websearch-providers/tavily
   * @example PATCH /websearch-providers/tavily { "apiKey": "new-key" }
   */
  '/websearch-providers/:id': {
    /** Get a provider by ID */
    GET: {
      params: { id: string }
      response: WebSearchProvider
    }
    /** Update a provider */
    PATCH: {
      params: { id: string }
      body: UpdateWebSearchProviderDto
      response: WebSearchProvider
    }
  }

  /**
   * Provider connection test endpoint
   * @example POST /websearch-providers/tavily/test
   */
  '/websearch-providers/:id/test': {
    /** Test provider connection and credentials */
    POST: {
      params: { id: string }
      response: TestProviderResponse
    }
  }
}
