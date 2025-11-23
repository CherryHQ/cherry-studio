// https://github.com/vercel/ai/blob/6306603220f9f023fcdbeb9768d1c3fc2ca6bc80/packages/provider-utils/src/validate-types.ts
import { asSchema, type Schema } from './schema'

/**
 * Validates the types of an unknown object using a schema and
 * return a strongly-typed object.
 *
 * @template T - The type of the object to validate.
 * @param {string} options.value - The object to validate.
 * @param {Validator<T>} options.schema - The schema to use for validating the JSON.
 * @returns {Promise<T>} - The typed object.
 */
export async function validateTypes<OBJECT>({
  value,
  schema
}: {
  value: unknown
  schema: Schema<OBJECT>
}): Promise<OBJECT> {
  const result = await safeValidateTypes({ value, schema })

  if (!result.success) {
    throw Error(`Validation failed: ${result.error.message}`)
  }

  return result.value
}

/**
 * Safely validates the types of an unknown object using a schema and
 * return a strongly-typed object.
 *
 * @template T - The type of the object to validate.
 * @param {string} options.value - The JSON object to validate.
 * @param {Validator<T>} options.schema - The schema to use for validating the JSON.
 * @returns An object with either a `success` flag and the parsed and typed data, or a `success` flag and an error object.
 */
export async function safeValidateTypes<OBJECT>({ value, schema }: { value: unknown; schema: Schema<OBJECT> }): Promise<
  | {
      success: true
      value: OBJECT
      rawValue: unknown
    }
  | {
      success: false
      error: Error
      rawValue: unknown
    }
> {
  const actualSchema = asSchema(schema)

  try {
    if (actualSchema.validate == null) {
      return { success: true, value: value as OBJECT, rawValue: value }
    }

    const result = await actualSchema.validate(value)

    if (result.success) {
      return { success: true, value: result.value, rawValue: value }
    }

    return {
      success: false,
      error: Error(`Validation failed: ${result.error.message}`),
      rawValue: value
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error('Unknown validation error'),
      rawValue: value
    }
  }
}
