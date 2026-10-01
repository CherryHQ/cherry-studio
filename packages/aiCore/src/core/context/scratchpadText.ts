/** Opening tag of model-authored scratchpad wrappers (`<thinking>`, `<analysis>`, …). */
const SCRATCHPAD_OPENING_TAG = /^\s*<([a-z][a-z0-9]*)\b/i

/** Paired simple-tag blocks the compaction model uses as disposable reasoning scaffolding. */
const PAIRED_SCRATCHPAD_BLOCK = /<([a-z][a-z0-9]*)\b[^>]*>[\s\S]*?<\/\1\s*>/gi

export function textStartsWithModelScratchpadTag(text: string): boolean {
  return SCRATCHPAD_OPENING_TAG.test(text)
}

/**
 * Removes model scratchpad scaffolding from compaction output. Tag names are not fixed —
 * models may emit `<thinking>`, `<analysis>`, `<assessment>`, or other simple wrappers.
 */
export function stripModelScratchpadBlocks(raw: string): string {
  let out = raw

  const summaryMatch = out.match(/<summary>([\s\S]*?)<\/summary>/i)
  if (summaryMatch) {
    out = summaryMatch[1]
  }

  let previous: string
  do {
    previous = out
    out = out.replace(PAIRED_SCRATCHPAD_BLOCK, '')
  } while (out !== previous)

  return out.replace(/\n{3,}/g, '\n\n').trim()
}
