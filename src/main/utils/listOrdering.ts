export function parseJsonSortKey(encoded: string, type: 'string' | 'number') {
  try {
    const key: unknown = JSON.parse(encoded)
    return typeof key === 'string' && type === 'string'
      ? key
      : typeof key === 'number' && type === 'number' && Number.isFinite(key)
        ? key
        : null
  } catch {
    return null
  }
}

type NamedRow = { id: string; name: string }

export function selectNamePage({
  names,
  after,
  compare,
  limit
}: {
  names: NamedRow[]
  after?: NamedRow
  compare: (a: NamedRow, b: NamedRow) => number
  limit: number
}) {
  return names
    .filter((row) => !after || compare(row, after) > 0)
    .sort(compare)
    .slice(0, limit)
}
