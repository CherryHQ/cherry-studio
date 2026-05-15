import type { ApiSchemas } from './schemas'

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
 * Raw template path union (schema keys themselves, containing `:param` placeholders).
 * Use this when callers want to pass `'/providers/:providerId'` and supply values via a
 * separate `params` field, instead of pre-resolving the path to a concrete string.
 */
export type TemplateApiPaths = keyof ApiSchemas & string

/**
 * Union accepted by all data hooks: either a concrete path or a raw template path.
 * Template paths trigger a `params` requirement; concrete paths disallow `params`.
 */
export type ApiPath = ConcreteApiPaths | TemplateApiPaths

/**
 * Reverse lookup: from concrete path back to original template path
 * Used to determine which ApiSchema entry matches a concrete path
 */
export type MatchApiPath<Path extends string> = {
  [K in keyof ApiSchemas]: Path extends ResolvedPath<K & string> ? K : never
}[keyof ApiSchemas]

/**
 * Resolve a path (template or concrete) to its matching schema key.
 * Template paths (literal `keyof ApiSchemas`) take a fast path to avoid the
 * `ResolvedPath` reverse-match collapsing multiple schemas into a union.
 */
type SchemaKeyForPath<Path extends string> = Path extends TemplateApiPaths ? Path : MatchApiPath<Path>

/**
 * Extract path parameters type declared in a schema method.
 * Returns `never` for schema methods that don't declare a `params` field.
 */
export type ParamsForPath<Path extends string, Method extends string> = SchemaKeyForPath<Path> extends keyof ApiSchemas
  ? ApiSchemas[SchemaKeyForPath<Path>] extends { [M in Method]: { params: infer P } }
    ? P
    : never
  : never

/**
 * Extract query parameters type for a given concrete path and HTTP method
 */
export type QueryParamsForPath<
  Path extends string,
  Method extends 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
> = SchemaKeyForPath<Path> extends keyof ApiSchemas
  ? ApiSchemas[SchemaKeyForPath<Path>] extends { [M in Method]: { query?: infer Q } }
    ? Q
    : Record<string, any>
  : Record<string, any>

/**
 * Extract request body type for a given concrete path and HTTP method
 */
export type BodyForPath<Path extends string, Method extends string> = SchemaKeyForPath<Path> extends keyof ApiSchemas
  ? ApiSchemas[SchemaKeyForPath<Path>] extends { [M in Method]: { body: infer B } }
    ? B
    : any
  : any

/**
 * Extract response type for a given concrete path and HTTP method
 */
export type ResponseForPath<
  Path extends string,
  Method extends string
> = SchemaKeyForPath<Path> extends keyof ApiSchemas
  ? ApiSchemas[SchemaKeyForPath<Path>] extends { [M in Method]: { response: infer R } }
    ? R
    : any
  : any
