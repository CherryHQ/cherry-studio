import type { JsonValue } from '@cherrystudio/agent-runtime'

export type Fields = { readonly [field: string]: JsonValue }
/** Whether `value` is a JSON object (not an array, null or a scalar). */
export const isFields = (value: JsonValue | undefined): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
/** `value` as a JSON object, or `undefined` for anything else (arrays, null, scalars). */
export const fieldsOf = (value: JsonValue | undefined): Fields | undefined => (isFields(value) ? value : undefined)
/** A string field, or `undefined` when it is absent or not a string; tool arguments arrive as plain JSON. */
export function stringField(fields: Fields | undefined, name: string): string | undefined {
  const value = fields?.[name]
  return typeof value === 'string' ? value : undefined
}
export function numberField(fields: Fields | undefined, name: string): number | undefined {
  const value = fields?.[name]
  return typeof value === 'number' ? value : undefined
}
export function booleanField(fields: Fields | undefined, name: string): boolean | undefined {
  const value = fields?.[name]
  return typeof value === 'boolean' ? value : undefined
}
