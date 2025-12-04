/**
 * Convert a value (string | undefined | null | boolean) into an option-compatible string.
 * - `undefined` becomes the literal string `'undefined'`
 * - `null` becomes the literal string `'null'`
 * - `true` becomes the literal string `'true'`
 * - `false` becomes the literal string `'false'`
 * - Any other string is returned as-is
 *
 * @param v - The value to convert
 * @returns The string representation safe for option usage
 */
export function toOptionValue(v: undefined): 'undefined'
export function toOptionValue(v: null): 'null'
export function toOptionValue(v: boolean): 'true' | 'false'
export function toOptionValue(v: boolean | undefined): 'true' | 'false' | 'undefined'
export function toOptionValue(v: boolean | null): 'true' | 'false' | 'null'
export function toOptionValue(v: boolean | undefined | null): 'true' | 'false' | 'undefined' | 'null'
export function toOptionValue<T extends string>(v: T): T
export function toOptionValue<T extends string | undefined>(v: T): NonNullable<T> | 'undefined'
export function toOptionValue<T extends string | null>(v: T): NonNullable<T> | 'null'
export function toOptionValue<T extends string | boolean>(v: T): T | 'true' | 'false'
export function toOptionValue<T extends string | null | undefined>(v: T): NonNullable<T> | 'null' | 'undefined'
export function toOptionValue<T extends string | null | boolean>(v: T): NonNullable<T> | 'null' | 'true' | 'false'
export function toOptionValue<T extends string | undefined | boolean>(
  v: T
): NonNullable<T> | 'undefined' | 'true' | 'false'
export function toOptionValue<T extends string | null | undefined | boolean>(
  v: T
): NonNullable<T> | 'null' | 'undefined' | 'true' | 'false'
export function toOptionValue(v: string | undefined | null | boolean) {
  return String(v)
}

/**
 * Convert an option string back to its original value.
 * - The literal string `'undefined'` becomes `undefined`
 * - The literal string `'null'` becomes `null`
 * - The literal string `'true'` becomes `true`
 * - The literal string `'false'` becomes `false`
 * - Any other string is returned as-is
 *
 * @param v - The option string to convert
 * @returns The real value (`undefined`, `null`, `boolean`, or the original string)
 */
export function toRealValue(v: 'undefined'): undefined
export function toRealValue(v: 'null'): null
export function toRealValue(v: 'true' | 'false'): boolean
export function toRealValue(v: 'undefined' | 'null'): undefined | null
export function toRealValue(v: 'undefined' | 'true' | 'false'): undefined | boolean
export function toRealValue(v: 'null' | 'true' | 'false'): null | boolean
export function toRealValue(v: 'undefined' | 'null' | 'true' | 'false'): undefined | null | boolean
export function toRealValue<T extends string>(v: T): Exclude<T, 'undefined' | 'null' | 'true' | 'false'>
export function toRealValue(v: string) {
  if (v === 'undefined') return undefined
  if (v === 'null') return null
  if (v === 'true') return true
  if (v === 'false') return false
  return v
}
