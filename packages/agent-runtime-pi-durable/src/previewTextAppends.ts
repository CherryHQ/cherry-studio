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
      leaf !== 'text' ||
      !text
    )
      return
    const part = typeof index === 'string' && /^(0|[1-9][0-9]*)$/.test(index) ? Number(index) : index
    if (typeof part !== 'number' || !Number.isSafeInteger(part) || part < 0) return
    appends.push({ part, text })
  }
  return appends
}
