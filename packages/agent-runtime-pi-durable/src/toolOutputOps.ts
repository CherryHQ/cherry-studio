import type { Op } from '@earendil-works/chord/delta'

function toolSlotIndex(slot: string | number | undefined): number | undefined {
  const index = typeof slot === 'string' && /^(0|[1-9][0-9]*)$/.test(slot) ? Number(slot) : slot
  if (typeof index === 'number' && Number.isSafeInteger(index) && index >= 0) return index
}

/** Locates slots touched by a batch containing only changes to running tool output. */
export function toolPreviewIndices(
  ops: readonly Op[],
  root: 'view' | 'live-document' = 'view'
): Set<number> | undefined {
  if (!ops.length) return
  const slots = new Set<number>()
  for (const [kind, path] of ops) {
    if (kind !== 's' && kind !== 'a' && kind !== 't') return
    if (root === 'view' && (path[0] !== 'docs' || path[1] !== 'pi.live')) return
    const offset = root === 'view' ? 2 : 0
    if (path.length !== offset + 3 || path[offset] !== 'tools' || path[offset + 2] !== 'output') return
    const index = toolSlotIndex(path[offset + 1])
    if (index === undefined) return
    slots.add(index)
  }
  return slots
}

/** A simple tool receipt appends one entry and changes only that tool's slot. */
export function toolResultSlot(ops: readonly Op[], entryCount: number): number | undefined {
  let appended = false
  let slot: number | undefined
  for (const op of ops) {
    if (op[0] === 'p') {
      const [, path, at, removed, entries] = op
      if (
        appended ||
        path.length !== 1 ||
        path[0] !== 'entries' ||
        at !== entryCount ||
        removed ||
        entries.length !== 1
      )
        return
      appended = true
      continue
    }
    const [kind, path] = op
    if (kind !== 's' && kind !== 'd' && kind !== 'a' && kind !== 't') return
    if (path.length !== 5 || path[0] !== 'docs' || path[1] !== 'pi.live' || path[2] !== 'tools') return
    const index = toolSlotIndex(path[3])
    if (index === undefined || (slot !== undefined && slot !== index)) return
    if (path[4] !== 'entry' && path[4] !== 'status' && path[4] !== 'output') return
    slot = index
  }
  if (appended) return slot
}
