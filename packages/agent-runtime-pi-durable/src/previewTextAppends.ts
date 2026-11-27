import type { Op } from '@earendil-works/chord/delta'

export interface PreviewTextAppend {
  readonly part: number
  readonly text: string
}

/** Accept only batches whose native changes append to generation text leaves. */
export function previewTextAppends(
  ops: readonly Op[],
  root: 'view' | 'live-document' = 'view'
): PreviewTextAppend[] | undefined {
  if (!ops.length) return
  const appends: PreviewTextAppend[] = []
  for (const op of ops) {
    if (op[0] !== 'a') return
    const [, path, text] = op
    if (root === 'view' && (path[0] !== 'docs' || path[1] !== 'pi.live')) return
    const blockPath = root === 'view' ? path.slice(2) : path
    const [generation, message, content, index, leaf] = blockPath
    if (
      blockPath.length !== 5 ||
      generation !== 'generation' ||
      message !== 'message' ||
      content !== 'content' ||
      (leaf !== 'text' && leaf !== 'thinking') ||
      !text
    )
      return
    const part = typeof index === 'string' && /^(0|[1-9][0-9]*)$/.test(index) ? Number(index) : index
    if (typeof part !== 'number' || !Number.isSafeInteger(part) || part < 0) return
    appends.push({ part, text })
  }
  return appends
}

/** Only tail insertions preserve existing native block addresses. */
export function previewContentIndices(
  ops: readonly Op[],
  length: number,
  root: 'view' | 'live-document' = 'view'
): Set<number> | undefined {
  if (!ops.length) return
  const indices = new Set<number>()
  for (const op of ops) {
    const [kind, path] = op
    if (kind === 'r' || (root === 'view' && (path[0] !== 'docs' || path[1] !== 'pi.live'))) return
    const offset = root === 'view' ? 2 : 0
    if (path[offset] !== 'generation' || path[offset + 1] !== 'message' || path[offset + 2] !== 'content') return
    if (path.length === offset + 3) {
      if (op[0] !== 'p' || op[2] !== length || op[3] !== 0) return
      const end = length + op[4].length
      while (length < end) indices.add(length++)
    } else {
      const key = path[offset + 3]
      const index = typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) ? Number(key) : key
      if (
        typeof index !== 'number' ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= length ||
        (path.length === offset + 4 && kind !== 's')
      )
        return
      indices.add(index)
    }
  }
  return indices
}
