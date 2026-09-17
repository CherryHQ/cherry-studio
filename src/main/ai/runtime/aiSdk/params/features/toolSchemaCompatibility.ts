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
 *   - a Gemini-only pass drops a function tool when an array has no typed
 *     `items` schema; there is no safe element type to infer.
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
 * Recurses only through schema-bearing keys, so a *property named* `minimum`
 * survives while the `minimum` **keyword** goes. Returns the same reference
 * when nothing was removed.
 */
function stripKeywords(schema: JSONSchema7Definition, keywords: ReadonlySet<string>): JSONSchema7Definition {
  if (typeof schema !== 'object' || schema === null) return schema

  const result: Record<string, unknown> = {}
  let changed = false
  for (const [key, value] of Object.entries(schema)) {
    if (keywords.has(key)) {
      changed = true
      continue
    }
    let next = value
    if (SCHEMA_MAPS.has(key) && typeof value === 'object' && value !== null) {
      next = stripMap(value as Record<string, JSONSchema7Definition>, keywords)
    } else if (SCHEMA_LISTS.has(key) && Array.isArray(value)) {
      next = stripList(value, keywords)
    } else if (SCHEMA_VALUES.has(key)) {
      next = Array.isArray(value) ? stripList(value, keywords) : stripKeywords(value, keywords)
    }
    if (next !== value) changed = true
    result[key] = next
  }
  return changed ? result : schema
}

function stripList(list: unknown[], keywords: ReadonlySet<string>): unknown[] {
  let changed = false
  const next = list.map((item) => {
    const mapped = stripKeywords(item as JSONSchema7Definition, keywords)
    if (mapped !== item) changed = true
    return mapped
  })
  return changed ? next : list
}

function stripMap(
  map: Record<string, JSONSchema7Definition>,
  keywords: ReadonlySet<string>
): Record<string, JSONSchema7Definition> {
  let changed = false
  const next: Record<string, JSONSchema7Definition> = {}
  for (const [key, value] of Object.entries(map)) {
    next[key] = stripKeywords(value, keywords)
    if (next[key] !== value) changed = true
  }
  return changed ? next : map
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

  let changed = false
  const droppedTools: string[] = []
  const transformedTools: NonNullable<LanguageModelV3CallOptions['tools']> = []
  for (const tool of tools) {
    if (tool.type !== 'function') {
      transformedTools.push(tool)
      continue
    }
    if (
      scope.endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT &&
      scope.sdkConfig.providerId !== 'google-vertex-maas' &&
      hasIncompatibleGeminiArray(tool.inputSchema)
    ) {
      changed = true
      droppedTools.push(tool.name)
      continue
    }
    const keywords = tool.strict === true ? STRICT_UNSUPPORTED : new Set(ALWAYS_UNSUPPORTED)
    const inputSchema = stripKeywords(tool.inputSchema, keywords)
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
