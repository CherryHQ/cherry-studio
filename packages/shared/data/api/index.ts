/**
 * Cherry Studio Data API - Barrel Exports
 *
 * This file provides a centralized entry point for all data API types,
 * schemas, and utilities. Import everything you need from this single location.
 *
 * @example
 * ```typescript
 * import { Topic, CreateTopicDto, ApiSchemas, DataRequest, ErrorCode } from '@/shared/data'
 * ```
 */

// Core data API types and infrastructure
export type {
  BatchRequest,
  BatchResponse,
  CacheOptions,
  DataApiError,
  DataRequest,
  DataResponse,
  HttpMethod,
  Middleware,
  PaginatedResponse,
  PaginationParams,
  RequestContext,
  ServiceOptions,
  ServiceResult,
  SubscriptionCallback,
  SubscriptionOptions,
  TransactionRequest
} from './apiTypes'
export { ErrorCode, SubscriptionEvent } from './apiTypes'

// Domain models and DTOs
export type {
  BulkOperationRequest,
  BulkOperationResponse,
  CreateTestItemDto,
  TestItem,
  UpdateTestItemDto
} from './apiModels'

// API schema definitions and type helpers
export type {
  ApiBody,
  ApiClient,
  ApiMethods,
  ApiParams,
  ApiPaths,
  ApiQuery,
  ApiResponse,
  ApiSchemas
} from './apiSchemas'

// Path type utilities for template literal types
export type {
  BodyForPath,
  ConcreteApiPaths,
  MatchApiPath,
  QueryParamsForPath,
  ResolvedPath,
  ResponseForPath
} from './apiPaths'

// Error handling utilities
export {
  ErrorCode as DataApiErrorCode,
  DataApiErrorFactory,
  ERROR_MESSAGES,
  ERROR_STATUS_MAP,
  isDataApiError,
  toDataApiError
} from './errorCodes'

/**
 * Re-export commonly used type combinations for convenience
 */

// Import types for re-export convenience types
import type { CreateTestItemDto, TestItem, UpdateTestItemDto } from './apiModels'
import type {
  BatchRequest,
  BatchResponse,
  DataApiError,
  DataRequest,
  DataResponse,
  ErrorCode,
  PaginatedResponse,
  PaginationParams,
  TransactionRequest
} from './apiTypes'
import type { DataApiErrorFactory } from './errorCodes'

/** All test item-related types */
export type TestItemTypes = {
  TestItem: TestItem
  CreateTestItemDto: CreateTestItemDto
  UpdateTestItemDto: UpdateTestItemDto
}

/** All error-related types and utilities */
export type ErrorTypes = {
  DataApiError: DataApiError
  ErrorCode: ErrorCode
  ErrorFactory: typeof DataApiErrorFactory
}

/** All request/response types */
export type RequestTypes = {
  DataRequest: DataRequest
  DataResponse: DataResponse
  BatchRequest: BatchRequest
  BatchResponse: BatchResponse
  TransactionRequest: TransactionRequest
}

/** All pagination-related types */
export type PaginationTypes = {
  PaginationParams: PaginationParams
  PaginatedResponse: PaginatedResponse<any>
}
