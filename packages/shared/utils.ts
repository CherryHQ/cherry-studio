export const defaultAppHeaders = () => {
  return {
    'HTTP-Referer': 'https://cherry-ai.com',
    'X-Title': 'Cherry Studio'
  }
}
/**
 * Converts an `undefined` value to `null`, otherwise returns the value as-is.
 * @param value - The value to check
 * @returns `null` if the input is `undefined`; otherwise the input value
 */

export function defined<T>(value: T | undefined): T | null {
  if (value === undefined) {
    return null
  } else {
    return value
  }
} /**
 * Converts a `null` value to `undefined`, otherwise returns the value as-is.
 * @param value - The value to check
 * @returns `undefined` if the input is `null`; otherwise the input value
 */

export function notNull<T>(value: T | null): T | undefined {
  if (value === null) {
    return undefined
  } else {
    return value
  }
}
