import { createHash } from 'node:crypto'

export const sortKeys = (value) =>
  Array.isArray(value)
    ? value.map(sortKeys)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sortKeys(value[key])])
        )
      : value

// Content identity is shared by generation and legacy publication; array order remains significant.
export const stampAndSerialize = (body) => {
  const sorted = sortKeys(body)
  const version = createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16)
  return JSON.stringify(sortKeys({ ...sorted, version }), null, 2) + '\n'
}
