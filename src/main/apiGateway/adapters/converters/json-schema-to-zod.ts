/**
 * JSON Schema to Zod Converter
 *
 * Converts JSON Schema definitions to Zod schemas for runtime validation.
 * This is used to convert tool input schemas from Anthropic format to AI SDK format.
 */

import type { JSONSchema7 } from '@ai-sdk/provider'
import * as z from 'zod'

/**
 * JSON Schema type alias
 */
export type JsonSchemaLike = JSONSchema7

/**
 * Convert JSON Schema to Zod schema
 *
 * Handles:
 * - Primitive types (string, number, integer, boolean, null)
 * - Complex types (object, array)
 * - Enums
 * - Union types (type: ["string", "null"])
 * - Required/optional fields
 * - Validation constraints (min/max, pattern, etc.)
 *
 * @example
 * ```typescript
 * const zodSchema = jsonSchemaToZod({
 *   type: 'object',
 *   properties: {
 *     name: { type: 'string' },
 *     age: { type: 'integer', minimum: 0 }
 *   },
 *   required: ['name']
 * })
 * ```
 */
export function jsonSchemaToZod(schema: JsonSchemaLike): z.ZodTypeAny {
  const schemaType = schema.type
  const enumValues = schema.enum
  const description = schema.description

  // Handle enum first
  if (enumValues && Array.isArray(enumValues) && enumValues.length > 0) {
    if (enumValues.every((v) => typeof v === 'string')) {
      const zodEnum = z.enum(enumValues as [string, ...string[]])
      return description ? zodEnum.describe(description) : zodEnum
    }
    // For non-string enums, use union of literals
    const literals = enumValues.map((v) => z.literal(v as string | number | boolean))
    if (literals.length === 1) {
      return description ? literals[0].describe(description) : literals[0]
    }
    const zodUnion = z.union(literals as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
    return description ? zodUnion.describe(description) : zodUnion
  }

  // Handle union types (type: ["string", "null"])
  if (Array.isArray(schemaType)) {
    const schemas = schemaType.map((t) =>
      jsonSchemaToZod({
        ...schema,
        type: t,
        enum: undefined
      })
    )
    if (schemas.length === 1) {
      return schemas[0]
    }
    return z.union(schemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
  }

  // Handle by type
  switch (schemaType) {
    case 'string': {
      let zodString = z.string()
      if (typeof schema.minLength === 'number') zodString = zodString.min(schema.minLength)
      if (typeof schema.maxLength === 'number') zodString = zodString.max(schema.maxLength)
      if (typeof schema.pattern === 'string') zodString = zodString.regex(new RegExp(schema.pattern))
      return description ? zodString.describe(description) : zodString
    }

    case 'number':
    case 'integer': {
      let zodNumber = schemaType === 'integer' ? z.number().int() : z.number()
      if (typeof schema.minimum === 'number') zodNumber = zodNumber.min(schema.minimum)
      if (typeof schema.maximum === 'number') zodNumber = zodNumber.max(schema.maximum)
      return description ? zodNumber.describe(description) : zodNumber
    }

    case 'boolean': {
      const zodBoolean = z.boolean()
      return description ? zodBoolean.describe(description) : zodBoolean
    }

    case 'null':
      return z.null()

    case 'array': {
      const items = schema.items
      let zodArray: z.ZodArray<z.ZodTypeAny>
      if (items && typeof items === 'object' && !Array.isArray(items)) {
        zodArray = z.array(jsonSchemaToZod(items as JsonSchemaLike))
      } else {
        zodArray = z.array(z.unknown())
      }
      if (typeof schema.minItems === 'number') zodArray = zodArray.min(schema.minItems)
      if (typeof schema.maxItems === 'number') zodArray = zodArray.max(schema.maxItems)
      return description ? zodArray.describe(description) : zodArray
    }

    case 'object': {
      const properties = schema.properties
      const required = schema.required || []

      // Always use z.object() to ensure "properties" field is present in output schema
      // OpenAI requires explicit properties field even for empty objects
      const shape: Record<string, z.ZodTypeAny> = {}
      if (properties && typeof properties === 'object') {
        for (const [key, propSchema] of Object.entries(properties)) {
          if (typeof propSchema === 'boolean') {
            shape[key] = propSchema ? z.unknown() : z.never()
          } else {
            const zodProp = jsonSchemaToZod(propSchema as JsonSchemaLike)
            shape[key] = required.includes(key) ? zodProp : zodProp.optional()
          }
        }
      }

      const zodObject = z.object(shape)
      return description ? zodObject.describe(description) : zodObject
    }

    default:
      // Unknown type, use z.unknown()
      return z.unknown()
  }
}

export default jsonSchemaToZod
