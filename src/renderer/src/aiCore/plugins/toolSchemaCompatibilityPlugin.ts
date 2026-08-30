import type { JSONSchema7, JSONSchema7Definition, LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { definePlugin } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import type { LanguageModelMiddleware } from 'ai'

const logger = loggerService.withContext('toolSchemaCompatibilityPlugin')

const ALWAYS_UNSUPPORTED = new Set(['$schema', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'uniqueItems'])
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
const SCHEMA_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'])
const SCHEMA_LISTS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])
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
    if (SCHEMA_MAPS.has(key) && typeof value === 'object' && value !== null && !Array.isArray(value)) {
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
  const result = list.map((item) => {
    const next = stripKeywords(item as JSONSchema7Definition, keywords)
    if (next !== item) changed = true
    return next
  })
  return changed ? result : list
}

function stripMap(
  map: Record<string, JSONSchema7Definition>,
  keywords: ReadonlySet<string>
): Record<string, JSONSchema7Definition> {
  let changed = false
  const result: Record<string, JSONSchema7Definition> = {}
  for (const [key, value] of Object.entries(map)) {
    result[key] = stripKeywords(value, keywords)
    if (result[key] !== value) changed = true
  }
  return changed ? result : map
}

function hasUntypedArray(schema: JSONSchema7Definition): boolean {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return false

  const isArray = schema.type === 'array' || (Array.isArray(schema.type) && schema.type.includes('array'))
  if (isArray) {
    const items = schema.items
    const hasTypedItems =
      items === true ||
      (typeof items === 'object' &&
        items !== null &&
        !Array.isArray(items) &&
        (typeof items.type === 'string' || (Array.isArray(items.type) && items.type.length > 0)))
    if (!hasTypedItems) {
      return true
    }
  }

  return Object.entries(schema).some(([key, value]) => {
    if (SCHEMA_MAPS.has(key) && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return Object.values(value).some((item) => hasUntypedArray(item as JSONSchema7Definition))
    }
    if (SCHEMA_LISTS.has(key) && Array.isArray(value)) {
      return value.some((item) => hasUntypedArray(item as JSONSchema7Definition))
    }
    if (!SCHEMA_VALUES.has(key)) return false
    return Array.isArray(value)
      ? value.some((item) => hasUntypedArray(item as JSONSchema7Definition))
      : hasUntypedArray(value as JSONSchema7Definition)
  })
}

function createMiddleware(dropUntypedArrays: boolean): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      if (!params.tools) return params

      let changed = false
      const droppedTools: string[] = []
      const tools: NonNullable<LanguageModelV3CallOptions['tools']> = []
      for (const tool of params.tools) {
        if (tool.type !== 'function') {
          tools.push(tool)
          continue
        }
        if (dropUntypedArrays && hasUntypedArray(tool.inputSchema)) {
          changed = true
          droppedTools.push(tool.name)
          continue
        }

        const inputSchema = stripKeywords(
          tool.inputSchema,
          tool.strict === true ? STRICT_UNSUPPORTED : ALWAYS_UNSUPPORTED
        )
        tools.push(inputSchema === tool.inputSchema ? tool : { ...tool, inputSchema: inputSchema as JSONSchema7 })
        if (inputSchema !== tool.inputSchema) changed = true
      }

      if (droppedTools.length > 0) {
        logger.warn('Dropped tools with Gemini-incompatible array schemas', { toolNames: droppedTools })
      }
      return changed ? { ...params, tools } : params
    }
  }
}

export const createToolSchemaCompatibilityPlugin = ({ dropUntypedArrays }: { dropUntypedArrays: boolean }) =>
  definePlugin({
    name: 'toolSchemaCompatibility',
    enforce: 'pre',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(createMiddleware(dropUntypedArrays))
    }
  })
