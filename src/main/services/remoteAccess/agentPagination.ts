import { RemoteRpcError } from '@cherrystudio/remote-transport'

export const DEFAULT_PAGE = 20
// Reserve 3,257 B: 59 structure + 1,538 each for escaped ID/cursor + 99 commas + 23 systemWorkspace.
// The item budget is 65,536 − 3,257; measure final wire DTOs, including JSON escaping.
export const PAGE_ITEM_BYTES = 62_279
export type Page<T> = { items: T[]; nextCursor: string | null }

const itemBytes = (item: unknown): number => Buffer.byteLength(JSON.stringify(item), 'utf8')
const exhausted = (bytes: number) =>
  new RemoteRpcError('RESOURCE_EXHAUSTED', 'Page item exceeds response byte budget', {
    kind: 'ITEM_TOO_LARGE',
    itemBytes: bytes,
    budgetBytes: PAGE_ITEM_BYTES,
    retryable: false
  })

/** Longest prefix of `items` from the offset cursor whose JSON fits one response record. */
export function pageOf<T>(items: readonly T[], cursor: string | undefined, limit: number | undefined): Page<T> {
  const start = cursor === undefined ? 0 : Number(cursor)
  if (!Number.isSafeInteger(start) || start < 0) throw new RemoteRpcError('NOT_FOUND', 'Invalid page cursor')
  const ceiling = Math.min(items.length, start + (limit ?? DEFAULT_PAGE))
  let end = start
  let bytes = 0
  while (end < ceiling) {
    const next = bytes + itemBytes(items[end]) + (end > start ? 1 : 0)
    if (next > PAGE_ITEM_BYTES) {
      if (end === start) throw exhausted(next)
      break
    }
    bytes = next
    end++
  }
  return { items: items.slice(start, end), nextCursor: end < items.length ? String(end) : null }
}

/** Re-runs a keyset-cursor query with a halved limit until its projected page fits one response record. */
export function queryPage<T>(read: (limit: number) => Page<T>, limit: number | undefined): Page<T> {
  let attempt = limit ?? DEFAULT_PAGE
  for (;;) {
    const page = read(attempt)
    const bytes = page.items.reduce((sum, item) => sum + itemBytes(item), 0) + Math.max(0, page.items.length - 1)
    if (bytes <= PAGE_ITEM_BYTES) return page
    if (attempt === 1) throw exhausted(bytes)
    attempt = Math.max(1, Math.floor(attempt / 2))
  }
}
