/**
 * Public utility functions for external consumers.
 *
 * This module is part of the PUBLIC API and can be imported via `@cherrystudio/ui/utils`.
 * For internal-only utilities (e.g., Tailwind class merging), use `lib/` instead.
 *
 * @module utils
 */

/**
 * Converts `null` to `undefined`, otherwise returns the input value.
 * Useful when interfacing with APIs or libraries that treat `null` and `undefined` differently.
 * @param data - The value that might be `null`
 * @returns `undefined` if `data` is `null`, otherwise the original value
 */
export const toUndefinedIfNull = <T>(data: T | null): T | undefined => {
  if (data === null) return undefined
  else return data
}

/**
 * Converts `undefined` to `null`, otherwise returns the input value.
 * Handy for ensuring consistent representation of absent values.
 * @param data - The value that might be `undefined`
 * @returns `null` if `data` is `undefined`, otherwise the original value
 */
export const toNullIfUndefined = <T>(data: T | undefined): T | null => {
  if (data === undefined) return null
  else return data
}
