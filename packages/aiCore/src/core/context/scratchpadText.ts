/** Model scratchpad wrappers named in compaction prompts and observed in leaked transcripts. */
export const MODEL_SCRATCHPAD_TAG_NAMES = ['analysis', 'assessment', 'thinking'] as const

const MODEL_SCRATCHPAD_TAG_SET = new Set<string>(MODEL_SCRATCHPAD_TAG_NAMES)

const SCRATCHPAD_OPENING_TAG = /^\s*<([a-z][a-z0-9]*)\b/i

function isModelScratchpadTagName(tag: string): boolean {
  return MODEL_SCRATCHPAD_TAG_SET.has(tag.toLowerCase())
}

export function textStartsWithModelScratchpadTag(text: string): boolean {
  const match = text.match(SCRATCHPAD_OPENING_TAG)
  return match ? isModelScratchpadTagName(match[1]) : false
}

/** Strips only known model scratchpad wrappers; leaves other markup intact. */
export function stripKnownModelScratchpadBlocks(raw: string): string {
  let out = raw
  let previous: string
  do {
    previous = out
    for (const tag of MODEL_SCRATCHPAD_TAG_NAMES) {
      const block = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi')
      out = out.replace(block, '')
    }
  } while (out !== previous)
  return out
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

  out = stripKnownModelScratchpadBlocks(out)

  return out.replace(/\n{3,}/g, '\n\n').trim()
}
