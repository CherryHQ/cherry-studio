// https://github.com/vercel/ai/blob/6306603220f9f023fcdbeb9768d1c3fc2ca6bc80/packages/provider-utils/src/schema.ts
import type { JSONSchema7 } from 'json-schema'
import * as z4 from 'zod/v4'

export type ValidationResult<OBJECT> = { success: true; value: OBJECT } | { success: false; error: Error }

const schemaSymbol = Symbol.for('schema')

export type Schema<OBJECT = unknown> = {
  /**
   * Used to mark schemas so we can support both Zod and custom schemas.
   */
  [schemaSymbol]: true

  /**
   * Schema type for inference.
   */
  _type: OBJECT

  /**
   * Optional. Validates that the structure of a value matches this schema,
   * and returns a typed version of the value if it does.
   */
  readonly validate?: (value: unknown) => ValidationResult<OBJECT> | PromiseLike<ValidationResult<OBJECT>>

  /**
   * The JSON Schema for the schema.
   */
  readonly jsonSchema: JSONSchema7 | PromiseLike<JSONSchema7>
}

export function asSchema<OBJECT>(schema: Schema<OBJECT> | undefined): Schema<OBJECT> {
  return schema == null
    ? jsonSchema({
        properties: {},
        additionalProperties: false
      })
    : schema
}

export function jsonSchema<OBJECT = unknown>(
  jsonSchema: JSONSchema7 | PromiseLike<JSONSchema7> | (() => JSONSchema7 | PromiseLike<JSONSchema7>),
  {
    validate
  }: {
    validate?: (value: unknown) => ValidationResult<OBJECT> | PromiseLike<ValidationResult<OBJECT>>
  } = {}
): Schema<OBJECT> {
  return {
    [schemaSymbol]: true,
    _type: undefined as OBJECT, // should never be used directly
    get jsonSchema() {
      if (typeof jsonSchema === 'function') {
        jsonSchema = jsonSchema() // cache the function results
      }
      return jsonSchema
    },
    validate
  }
}

export function zod4Schema<OBJECT>(
  zodSchema: z4.core.$ZodType<OBJECT, any>,
  options?: {
    /**
     * Enables support for references in the schema.
     * This is required for recursive schemas, e.g. with `z.lazy`.
     * However, not all language models and providers support such references.
     * Defaults to `false`.
     */
    useReferences?: boolean
  }
): Schema<OBJECT> {
  // default to no references (to support openapi conversion for google)
  const useReferences = options?.useReferences ?? false

  return jsonSchema(
    // defer json schema creation to avoid unnecessary computation when only validation is needed
    () =>
      z4.toJSONSchema(zodSchema, {
        target: 'draft-7',
        io: 'output',
        reused: useReferences ? 'ref' : 'inline'
      }) as JSONSchema7,
    {
      validate: async (value) => {
        const result = await z4.safeParseAsync(zodSchema, value)
        return result.success ? { success: true, value: result.data } : { success: false, error: result.error }
      }
    }
  )
}
