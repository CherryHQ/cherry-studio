export const defaultAppHeaders = () => {
  return {
    'HTTP-Referer': 'https://cherry-ai.com',
    'X-Title': 'Cherry Studio'
  }
}

// Following two function are not being used for now.
// I may use them in the future, so just keep them commented. - by eurfelux

/**
 * Converts an `undefined` value to `null`, otherwise returns the value as-is.
 * @param value - The value to check
 * @returns `null` if the input is `undefined`; otherwise the input value
 */

// export function toNullIfUndefined<T>(value: T | undefined): T | null {
//   if (value === undefined) {
//     return null
//   } else {
//     return value
//   }
// }

/**
 * Converts a `null` value to `undefined`, otherwise returns the value as-is.
 * @param value - The value to check
 * @returns `undefined` if the input is `null`; otherwise the input value
 */

// export function toUndefinedIfNull<T>(value: T | null): T | undefined {
//   if (value === null) {
//     return undefined
//   } else {
//     return value
//   }
// }
