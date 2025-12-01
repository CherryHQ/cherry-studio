/**
 * Convert a value (string | undefined | null) into an option-compatible string.
 * - `undefined` becomes the literal string `'undefined'`
 * - `null` becomes the literal string `'null'`
 * - Any other string is returned as-is
 *
 * @param v - The value to convert
 * @returns The string representation safe for option usage
 */
export function toOptionValue<T extends undefined | Exclude<string, null>>(v: T): NonNullable<T> | 'undefined'
export function toOptionValue<T extends null | Exclude<string, undefined>>(v: T): NonNullable<T> | 'null'
export function toOptionValue<T extends string | undefined | null>(v: T): NonNullable<T> | 'undefined' | 'null'
export function toOptionValue<T extends Exclude<string, null | undefined>>(v: T): T
export function toOptionValue(v: string | undefined | null) {
  if (v === undefined) return 'undefined'
  if (v === null) return 'null'
  return v
}

/**
 * Convert an option string back to its original value.
 * - The literal string `'undefined'` becomes `undefined`
 * - The literal string `'null'` becomes `null`
 * - Any other string is returned as-is
 *
 * @param v - The option string to convert
 * @returns The real value (`undefined`, `null`, or the original string)
 */
export function toRealValue<T extends 'undefined'>(v: T): undefined
export function toRealValue<T extends 'null'>(v: T): null
export function toRealValue<T extends string>(v: T): Exclude<T, 'undefined' | 'null'>
export function toRealValue(v: string) {
  if (v === 'undefined') return undefined
  if (v === 'null') return null
  return v
}
