import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge class names with tailwind-merge
 * This utility combines clsx and tailwind-merge for optimal class name handling
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

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
