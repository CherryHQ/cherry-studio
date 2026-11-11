export interface PiSubagentModelNames {
  readonly key: string
  readonly id: string
  readonly rawId: string
  readonly modelName: string
  readonly providerName: string
}

/**
 * Match one catalog model against a caller-supplied model query.
 * Returns undefined when nothing matches, otherwise whether the query is an exact name.
 */
export function matchPiSubagentModel(
  query: string,
  names: PiSubagentModelNames
): { readonly exact: boolean } | undefined {
  const needle = query.trim().toLowerCase()
  const searchable = [
    names.key,
    names.id,
    names.rawId,
    names.modelName,
    `${names.providerName} ${names.modelName}`
  ].map((name) => name.toLowerCase())
  return searchable.some((name) => name.includes(needle))
    ? { exact: needle !== '' && searchable.includes(needle) }
    : undefined
}
