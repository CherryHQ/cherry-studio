/**
 * API Module - Unified entry point
 *
 * This module exports all necessary components for the Data API system
 * Designed to be portable and reusable in different environments
 */

// Core components
export { ApiServer } from './core/ApiServer'
export { MiddlewareEngine } from './core/MiddlewareEngine'

// Adapters
export { IpcAdapter } from './core/adapters/IpcAdapter'
// export { HttpAdapter } from './core/adapters/HttpAdapter' // Future implementation

// Handlers (new type-safe system)
export { apiHandlers } from './handlers'

// Re-export types for convenience
export type {
  CursorPaginationParams,
  CursorPaginationResponse,
  DataRequest,
  DataResponse,
  Middleware,
  OffsetPaginationParams,
  OffsetPaginationResponse,
  PaginationResponse,
  RequestContext,
  SearchParams,
  ServiceOptions,
  SortParams
} from '@shared/data/api/apiTypes'
