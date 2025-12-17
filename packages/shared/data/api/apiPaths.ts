import type { ApiSchemas } from './apiSchemas'

/**
 * Template literal type utilities for converting parameterized paths to concrete paths
 * This enables type-safe API calls with actual paths like '/test/items/123' instead of '/test/items/:id'
 */

/**
 * Convert parameterized path templates to concrete path types
 * @example '/test/items/:id' -> '/test/items/${string}'
 * @example '/topics/:id/messages' -> '/topics/${string}/messages'
 */
export type ResolvedPath<T extends string> = T extends `${infer Prefix}/:${string}/${infer Suffix}`
  ? `${Prefix}/${string}/${ResolvedPath<Suffix>}`
  : T extends `${infer Prefix}/:${string}`
    ? `${Prefix}/${string}`
    : T

/**
 * Generate all possible concrete paths from ApiSchemas
 * This creates a union type of all valid API paths
 */
export type ConcreteApiPaths = {
  [K in keyof ApiSchemas]: ResolvedPath<K & string>
}[keyof ApiSchemas]

/**
 * Reverse lookup: from concrete path back to original template path
 * Used to determine which ApiSchema entry matches a concrete path
 */
export type MatchApiPath<Path extends string> = {
  [K in keyof ApiSchemas]: Path extends ResolvedPath<K & string> ? K : never
}[keyof ApiSchemas]

/**
 * Extract query parameters type for a given concrete path
 */
export type QueryParamsForPath<Path extends string> = MatchApiPath<Path> extends keyof ApiSchemas
  ? ApiSchemas[MatchApiPath<Path>] extends { GET: { query?: infer Q } }
    ? Q
    : Record<string, any>
  : Record<string, any>

/**
 * Extract request body type for a given concrete path and HTTP method
 */
export type BodyForPath<Path extends string, Method extends string> = MatchApiPath<Path> extends keyof ApiSchemas
  ? ApiSchemas[MatchApiPath<Path>] extends { [M in Method]: { body: infer B } }
    ? B
    : any
  : any

/**
 * Extract response type for a given concrete path and HTTP method
 */
export type ResponseForPath<Path extends string, Method extends string> = MatchApiPath<Path> extends keyof ApiSchemas
  ? ApiSchemas[MatchApiPath<Path>] extends { [M in Method]: { response: infer R } }
    ? R
    : any
  : any
