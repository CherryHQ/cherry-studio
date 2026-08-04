import { v4 as uuidv4 } from 'uuid'

/**
 * Generate a UUID v4 string.
 * @returns {string} A UUID v4 string
 */
export function uuid(): string {
  return uuidv4()
}
