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
 *
 * Local input validation is unaffected: the AI SDK still checks tool calls
 * against the original zod schema.
 */

import type { JSONSchema7, JSONSchema7Definition, LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { definePlugin } from '@cherrystudio/ai-core'
import type { LanguageModelMiddleware } from 'ai'

import type { RequestFeature } from '../feature'

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
  return changed ? (result as JSONSchema7) : schema
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

function normalizeToolSchemas(params: LanguageModelV3CallOptions): LanguageModelV3CallOptions {
  const tools = params.tools
  if (!tools) return params

  let changed = false
  const transformedTools = tools.map((tool) => {
    if (tool.type !== 'function') return tool
    const keywords = tool.strict === true ? STRICT_UNSUPPORTED : new Set(ALWAYS_UNSUPPORTED)
    const inputSchema = stripKeywords(tool.inputSchema as JSONSchema7Definition, keywords)
    if (inputSchema === tool.inputSchema) return tool
    changed = true
    return { ...tool, inputSchema: inputSchema as JSONSchema7 }
  })

  return changed ? { ...params, tools: transformedTools } : params
}

function createToolSchemaCompatibilityMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => normalizeToolSchemas(params)
  }
}

const createToolSchemaCompatibilityPlugin = () =>
  definePlugin({
    name: 'tool-schema-compatibility',
    enforce: 'pre',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(createToolSchemaCompatibilityMiddleware())
    }
  })

/** Drop JSON Schema keywords providers reject in function-tool schemas. */
export const toolSchemaCompatibilityFeature: RequestFeature = {
  name: 'tool-schema-compatibility',
  contributeModelAdapters: () => [createToolSchemaCompatibilityPlugin()]
}
