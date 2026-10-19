import type { JsonValue } from '@cherrystudio/agent-runtime'

export type Fields = { readonly [field: string]: JsonValue }
/** `value` as a JSON object, or `undefined` for anything else (arrays, null, scalars). */
export const fieldsOf = (value: JsonValue | undefined): Fields | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : undefined
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
