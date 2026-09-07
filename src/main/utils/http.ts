import { normalizeHeaders } from '@ai-sdk/provider-utils'

export const defaultAppHeaders = () => {
  return {
    'HTTP-Referer': 'https://cherry-ai.com',
    'X-Title': 'Cherry Studio'
  }
}

/**
 * Merge header records with case-insensitive last-writer-wins.
 *
 * A plain `{ ...defaults, ...extraHeaders }` keeps case variants of the same
 * name as separate keys — a default `User-Agent` plus a user-supplied
 * `user-agent` both reach the wire, and `new Headers(...).get()` comma-joins
 * them. Normalizing each part to lowercase first collapses them so the last
 * writer actually wins.
 *
 * @param parts - Header records in precedence order; later parts override earlier ones.
 * @returns A record with lowercase header names and no duplicates.
 */
export const mergeHeaders = (...parts: Array<Record<string, string | undefined> | undefined>): Record<string, string> =>
  Object.assign({}, ...parts.map(normalizeHeaders))
