/**
 * Replace Express-style path placeholders with values from `params`.
 *
 * Greedy placeholders (`:name*`) allow values containing `/`. The leading
 * slash anchor keeps verb-style suffixes such as `models:resolve` intact.
 */
export function resolveTemplate(path: string, params?: Record<string, string | number>): string {
  if (!params || !path.includes(':')) return path
  return path.replace(/(?<=\/):([a-zA-Z][a-zA-Z0-9]*)\*?/g, (_match, key) => {
    const value = params[key]
    if (value === undefined || value === null) {
      throw new Error(`Missing param "${key}" for path "${path}"`)
    }
    return String(value)
  })
}
