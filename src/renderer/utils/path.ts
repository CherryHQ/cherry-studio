/**
 * Joins a base path and a relative segment with a single separator, tolerating both `/` and `\`
 * and a trailing separator on `base`. Leading separators on `rel` are stripped so the result stays
 * anchored to `base`.
 */
export const joinPath = (base: string, rel: string): string => {
  const trimmed = rel.replace(/^[/\\]+/, '')
  if (!base) return trimmed
  return /[/\\]$/.test(base) ? `${base}${trimmed}` : `${base}/${trimmed}`
}
