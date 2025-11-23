// https://github.com/vercel/ai/blob/6306603220f9f023fcdbeb9768d1c3fc2ca6bc80/packages/provider-utils/src/parse-json.ts
import type { JSONValue } from '../json-value'
import type { Schema } from '../schema'
import { safeValidateTypes, validateTypes } from '../validate-type'
import { secureJsonParse } from './secure-json-parse'

/**
 * Parses a JSON string into an unknown object.
 *
 * @param text - The JSON string to parse.
 * @returns {JSONValue} - The parsed JSON object.
 */
export async function parseJSON(options: { text: string; schema?: undefined }): Promise<JSONValue>
/**
 * Parses a JSON string into a strongly-typed object using the provided schema.
 *
 * @template T - The type of the object to parse the JSON into.
 * @param {string} text - The JSON string to parse.
 * @param {Validator<T>} schema - The schema to use for parsing the JSON.
 * @returns {Promise<T>} - The parsed object.
 */
export async function parseJSON<T>(options: { text: string; schema: Schema<T> }): Promise<T>
export async function parseJSON<T>({ text, schema }: { text: string; schema?: Schema<T> }): Promise<T> {
  const value = secureJsonParse(text)

  if (schema == null) {
    return value
  }

  return validateTypes<T>({ value, schema })
}

export type ParseResult<T> =
  | { success: true; value: T; rawValue: unknown }
  | {
      success: false
      error: Error
      rawValue: unknown
    }

/**
 * Safely parses a JSON string and returns the result as an object of type `unknown`.
 *
 * @param text - The JSON string to parse.
 * @returns {Promise<object>} Either an object with `success: true` and the parsed data, or an object with `success: false` and the error that occurred.
 */
export async function safeParseJSON(options: { text: string; schema?: undefined }): Promise<ParseResult<JSONValue>>
/**
 * Safely parses a JSON string into a strongly-typed object, using a provided schema to validate the object.
 *
 * @template T - The type of the object to parse the JSON into.
 * @param {string} text - The JSON string to parse.
 * @param {Validator<T>} schema - The schema to use for parsing the JSON.
 * @returns An object with either a `success` flag and the parsed and typed data, or a `success` flag and an error object.
 */
export async function safeParseJSON<T>(options: { text: string; schema: Schema<T> }): Promise<ParseResult<T>>
export async function safeParseJSON<T>({
  text,
  schema
}: {
  text: string
  schema?: Schema<T>
}): Promise<ParseResult<T>> {
  try {
    const value = secureJsonParse(text)

    if (schema == null) {
      return { success: true, value: value as T, rawValue: value }
    }

    return await safeValidateTypes<T>({ value, schema })
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error('Unknown parsing error'),
      rawValue: undefined
    }
  }
}

export function isParsableJson(input: string): boolean {
  try {
    secureJsonParse(input)
    return true
  } catch {
    return false
  }
}
