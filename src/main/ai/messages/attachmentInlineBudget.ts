/** UTF-8 bytes conservatively bound ordinary byte-BPE tokens without tokenizing the body. */
export function allocateInlineCaps(bodies: readonly string[], tokens: number): number[] {
  const sizes = bodies.map((body) => Buffer.byteLength(body, 'utf8'))
  const allocated = allocateAttachmentBudget(sizes, tokens)
  return bodies.map((body, index) => {
    if (sizes[index] <= allocated[index]) return body.length
    let end = 0
    let bytes = 0
    for (const character of body) {
      bytes += Buffer.byteLength(character, 'utf8')
      if (bytes > allocated[index]) break
      end += character.length
    }
    return end
  })
}

/** Small files fit whole; larger files share the remaining request budget. */
export function allocateAttachmentBudget(sizes: readonly number[], total: number): number[] {
  const allocated = new Array<number>(sizes.length).fill(0)
  const smallestFirst = sizes.map((size, index) => ({ size, index })).sort((a, b) => a.size - b.size)
  let remaining = Math.max(0, total)
  let unserved = smallestFirst.length
  for (const { size, index } of smallestFirst) {
    const take = Math.min(Math.max(0, size), Math.floor(remaining / unserved))
    allocated[index] = take
    remaining -= take
    unserved--
  }
  return allocated
}
