/**
 * Normalizes function-tool JSON Schemas into what providers actually accept.
 *
 * Two passes, both always on — the keywords involved are advisory hints no
 * provider enforces, so dropping them everywhere costs nothing and beats
 * per-provider gating:
 *   - every function tool loses `$schema` (dialect metadata Gemini's parser
 *     rejects) and the keywords Gemini's Schema proto has no field for
 *     (`Unknown name "exclusiveMaximum" … Cannot find field`, issue #10052);
 *   - a `strict: true` tool additionally loses every validation keyword outside
 *     the strict subset — Anthropic and OpenAI compile that schema into a
 *     sampling grammar and 400 the whole request otherwise (issue #18037).
 *     Zod emits them freely (`.int()` alone adds safe-integer bounds).
 *   - a Gemini-only pass replaces non-string `enum`/`const` values with their
 *     bare type (Gemini's Schema proto types `enum` as string lists only) and
 *     drops a function tool when an array has no typed `items` schema; there
 *     is no safe element type to infer.
 *   - a Gemini-only pass drops `propertyNames` / `additionalProperties`
 *     (Gemini's Schema proto has no field for either — issue #20939).
 *     Custom Gemini relays translate client schemas literally, so the
 *     repo-owned middleware is the last choke point that can remove them.
 *
 * Local input validation is unaffected: the AI SDK still checks tool calls
 * against the original zod schema.
 */

import type { JSONSchema7, JSONSchema7Definition, LanguageModelV3CallOptions } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'

import { definePlugin } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import type { RequestFeature } from '../feature'
import type { RequestScope } from '../scope'

const logger = loggerService.withContext('toolSchemaCompatibility')

/** Rejected by Gemini, unenforced everywhere else. */
const ALWAYS_UNSUPPORTED = ['$schema', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'uniqueItems']

/** Gemini's function-declaration Schema has no field for these (issue #20939). */
const GEMINI_UNSUPPORTED = new Set(['propertyNames', 'additionalProperties'])

/** Outside the strict-mode subset (`format`, `enum`, `const` stay). */
const STRICT_UNSUPPORTED = new Set([
  ...ALWAYS_UNSUPPORTED,
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
  'minProperties',
  'maxProperties',
  'default'
])

/** Keys whose value is a map of schemas — recurse into the values, never filter the keys. */
const SCHEMA_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'])
/** Keys whose value is an array of schemas. */
const SCHEMA_LISTS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])
/** Keys whose value is a schema (`items` may also be an array of schemas in draft-07). */
const SCHEMA_VALUES = new Set([
  'items',
  'additionalItems',
  'additionalProperties',
  'contains',
  'propertyNames',
  'not',
  'if',
  'then',
  'else'
])

/**
 * Recurses only through schema-bearing keys, applying `mapNode` to every
 * schema node bottom-up — so a *property named* `minimum` survives while the
 * `minimum` **keyword** is only ever seen as a plain value. Returns the same
 * reference when nothing changed.
 */
function mapSchemas(schema: JSONSchema7Definition, mapNode: (node: JSONSchema7) => JSONSchema7): JSONSchema7Definition {
  if (typeof schema !== 'object' || schema === null) return schema

  const result: Record<string, unknown> = {}
  let changed = false
  for (const [key, value] of Object.entries(schema)) {
    let next = value
    if (SCHEMA_MAPS.has(key) && typeof value === 'object' && value !== null) {
      next = mapSchemaMap(value as Record<string, JSONSchema7Definition>, mapNode)
    } else if (SCHEMA_LISTS.has(key) && Array.isArray(value)) {
      next = mapSchemaList(value, mapNode)
    } else if (SCHEMA_VALUES.has(key)) {
      next = Array.isArray(value) ? mapSchemaList(value, mapNode) : mapSchemas(value, mapNode)
    }
    if (next !== value) changed = true
    result[key] = next
  }
  const mapped = mapNode(result)
  if (mapped !== (result as JSONSchema7)) changed = true
  return changed ? mapped : schema
}

function mapSchemaList(list: unknown[], mapNode: (node: JSONSchema7) => JSONSchema7): unknown[] {
  let changed = false
  const next = list.map((item) => {
    const mapped = mapSchemas(item as JSONSchema7Definition, mapNode)
    if (mapped !== item) changed = true
    return mapped
  })
  return changed ? next : list
}

function mapSchemaMap(
  map: Record<string, JSONSchema7Definition>,
  mapNode: (node: JSONSchema7) => JSONSchema7
): Record<string, JSONSchema7Definition> {
  let changed = false
  const next: Record<string, JSONSchema7Definition> = {}
  for (const [key, value] of Object.entries(map)) {
    next[key] = mapSchemas(value, mapNode)
    if (next[key] !== value) changed = true
  }
  return changed ? next : map
}

function dropKeywords(node: JSONSchema7, keywords: ReadonlySet<string>): JSONSchema7 {
  let changed = false
  const kept: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (keywords.has(key)) {
      changed = true
      continue
    }
    kept[key] = value
  }
  return changed ? kept : node
}

function stripKeywords(schema: JSONSchema7Definition, keywords: ReadonlySet<string>): JSONSchema7Definition {
  return mapSchemas(schema, (node) => dropKeywords(node, keywords))
}

/** The single simple type shared by every value, if one exists. */
function uniformEnumType(values: unknown[]): 'integer' | 'number' | 'boolean' | undefined {
  if (values.length === 0) return undefined
  if (values.every((value) => typeof value === 'boolean')) return 'boolean'
  if (values.every((value) => typeof value === 'number' && Number.isInteger(value))) return 'integer'
  if (values.every((value) => typeof value === 'number')) return 'number'
  return undefined
}

/**
 * Gemini's Schema proto types `enum` as a string list — a numeric or boolean
 * `enum`/`const` 400s the whole request (`Invalid value at '…enum[0]'
 * (TYPE_STRING)`, e.g. zod `z.union([z.literal(1), z.literal(2)])`). Replaces
 * it with the bare type; the original zod schema still validates locally.
 */
function stripNonStringEnums(node: JSONSchema7): JSONSchema7 {
  const values = node.enum !== undefined ? node.enum : node.const !== undefined ? [node.const] : undefined
  const kind = Array.isArray(values) ? uniformEnumType(values) : undefined
  if (kind === undefined) return node

  const replacement: JSONSchema7 = { ...node }
  delete replacement.enum
  delete replacement.const
  if (replacement.type === undefined) replacement.type = kind
  return replacement
}

function isGeminiArraySchema(schema: JSONSchema7): boolean {
  return schema.type === 'array' || (Array.isArray(schema.type) && schema.type.includes('array'))
}

function hasGeminiArrayItems(items: JSONSchema7['items']): boolean {
  // @ai-sdk/google serializes the `true` schema as a typed boolean schema.
  if (items === true) return true
  if (typeof items !== 'object' || items === null || Array.isArray(items)) return false
  return typeof items.type === 'string' || (Array.isArray(items.type) && items.type.length > 0)
}

/** Gemini's Schema requires every array declaration to carry a typed items schema. */
function hasIncompatibleGeminiArray(schema: JSONSchema7Definition): boolean {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return false

  const objectSchema = schema
  if (isGeminiArraySchema(objectSchema) && !hasGeminiArrayItems(objectSchema.items)) return true

  return Object.entries(objectSchema).some(([key, value]) => {
    if (SCHEMA_MAPS.has(key) && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return Object.values(value).some((entry) => hasIncompatibleGeminiArray(entry as JSONSchema7Definition))
    }
    if (SCHEMA_LISTS.has(key) && Array.isArray(value)) {
      return value.some((entry) => hasIncompatibleGeminiArray(entry as JSONSchema7Definition))
    }
    if (SCHEMA_VALUES.has(key)) {
      return Array.isArray(value)
        ? value.some((entry) => hasIncompatibleGeminiArray(entry as JSONSchema7Definition))
        : hasIncompatibleGeminiArray(value as JSONSchema7Definition)
    }
    return false
  })
}

function normalizeToolSchemas(params: LanguageModelV3CallOptions, scope: RequestScope): LanguageModelV3CallOptions {
  const tools = params.tools
  if (!tools) return params

  const isGeminiEndpoint =
    scope.endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT && scope.sdkConfig.providerId !== 'google-vertex-maas'

  let changed = false
  const droppedTools: string[] = []
  const transformedTools: NonNullable<LanguageModelV3CallOptions['tools']> = []
  for (const tool of tools) {
    if (tool.type !== 'function') {
      transformedTools.push(tool)
      continue
    }
    if (isGeminiEndpoint && hasIncompatibleGeminiArray(tool.inputSchema)) {
      changed = true
      droppedTools.push(tool.name)
      continue
    }
    const keywords = tool.strict === true ? STRICT_UNSUPPORTED : new Set(ALWAYS_UNSUPPORTED)
    let inputSchema = stripKeywords(tool.inputSchema, keywords)
    if (isGeminiEndpoint) inputSchema = stripKeywords(inputSchema, GEMINI_UNSUPPORTED)
    if (isGeminiEndpoint) inputSchema = mapSchemas(inputSchema, stripNonStringEnums)
    if (inputSchema === tool.inputSchema) transformedTools.push(tool)
    else {
      changed = true
      transformedTools.push({ ...tool, inputSchema: inputSchema as JSONSchema7 })
    }
  }

  if (droppedTools.length > 0) {
    logger.warn('Dropped tools with Gemini-incompatible array schemas', {
      providerId: scope.sdkConfig.providerId,
      toolNames: droppedTools
    })
  }

  return changed ? { ...params, tools: transformedTools } : params
}

function createToolSchemaCompatibilityMiddleware(scope: RequestScope): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => normalizeToolSchemas(params, scope)
  }
}

const createToolSchemaCompatibilityPlugin = (scope: RequestScope) =>
  definePlugin({
    name: 'tool-schema-compatibility',
    enforce: 'pre',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(createToolSchemaCompatibilityMiddleware(scope))
    }
  })

/** Drop provider-rejected JSON Schema keywords and unsafe Gemini array tools. */
export const toolSchemaCompatibilityFeature: RequestFeature = {
  name: 'tool-schema-compatibility',
  contributeModelAdapters: (scope) => [createToolSchemaCompatibilityPlugin(scope)]
}
