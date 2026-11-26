type StoredPart = { partId: string; pos?: number | null }

/** Restored parts without an assigned position keep their saved order after the preceding positioned part. */
export function orderAgentTimelineParts<T extends { partId: string; pos: number | null }>(
  parts: T[],
  readStored: () => readonly StoredPart[]
): T[] {
  if (parts.every((part) => part.pos !== null)) return parts.sort((a, b) => a.pos! - b.pos!)
  const legacy = new Map<string, { after: number; seq: number }>()
  let after = 0
  for (const [seq, part] of readStored().entries()) {
    if (part.pos != null) after = part.pos
    else legacy.set(part.partId, { after, seq: seq + 1 })
  }
  return parts.sort((a, b) => {
    const left = legacy.get(a.partId)
    const right = legacy.get(b.partId)
    return (a.pos ?? left!.after) - (b.pos ?? right!.after) || (left?.seq ?? 0) - (right?.seq ?? 0)
  })
}
