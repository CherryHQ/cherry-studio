/**
 * Branded Types for type-safe IDs
 *
 * Branded types prevent accidental misuse of primitive types (like string)
 * by adding compile-time type safety without runtime overhead.
 *
 * @example
 * ```typescript
 * const modelId = ModelId('gpt-4')  // ModelId type
 * const requestId = RequestId('req-123')  // RequestId type
 *
 * function processModel(id: ModelId) { ... }
 * processModel(requestId)  // ❌ Compile error - type mismatch
 * ```
 */

/**
 * Brand helper type
 */
type Brand<K, T> = K & { readonly __brand: T }

/**
 * Model ID branded type
 * Represents a unique model identifier
 */
export type ModelId = Brand<string, 'ModelId'>

/**
 * Request ID branded type
 * Represents a unique request identifier for tracing
 */
export type RequestId = Brand<string, 'RequestId'>

/**
 * Provider ID branded type
 * Represents a provider identifier (e.g., 'openai', 'anthropic')
 */
export type ProviderId = Brand<string, 'ProviderId'>

/**
 * Create a ModelId from a string
 * @param id - The model identifier string
 * @returns Branded ModelId
 */
export const ModelId = (id: string): ModelId => id as ModelId

/**
 * Create a RequestId from a string
 * @param id - The request identifier string
 * @returns Branded RequestId
 */
export const RequestId = (id: string): RequestId => id as RequestId

/**
 * Create a ProviderId from a string
 * @param id - The provider identifier string
 * @returns Branded ProviderId
 */
export const ProviderId = (id: string): ProviderId => id as ProviderId

/**
 * Type guard to check if a string is a valid ModelId
 */
export const isModelId = (value: unknown): value is ModelId => {
  return typeof value === 'string' && value.length > 0
}

/**
 * Type guard to check if a string is a valid RequestId
 */
export const isRequestId = (value: unknown): value is RequestId => {
  return typeof value === 'string' && value.length > 0
}

/**
 * Type guard to check if a string is a valid ProviderId
 */
export const isProviderId = (value: unknown): value is ProviderId => {
  return typeof value === 'string' && value.length > 0
}
