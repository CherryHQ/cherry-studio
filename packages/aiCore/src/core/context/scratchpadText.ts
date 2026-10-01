/** Model scratchpad wrappers named in compaction prompts and observed in leaked transcripts. */
export const MODEL_SCRATCHPAD_TAG_NAMES = ['analysis', 'assessment', 'thinking'] as const

const MODEL_SCRATCHPAD_TAG_SET = new Set<string>(MODEL_SCRATCHPAD_TAG_NAMES)

const SCRATCHPAD_OPENING_TAG = new RegExp(`^\\s*<(${MODEL_SCRATCHPAD_TAG_NAMES.join('|')})(?:(?=\\s[^/]*>)|(?=>))`, 'i')
const CODE_FENCE_PATTERN = /```[\s\S]*?```/g
const CODE_FENCE_PLACEHOLDER_PREFIX = '\uE000CODE_FENCE_'
const CODE_FENCE_PLACEHOLDER_SUFFIX = '\uE001'
const CODE_FENCE_PLACEHOLDER = new RegExp(`${CODE_FENCE_PLACEHOLDER_PREFIX}(\\d+)${CODE_FENCE_PLACEHOLDER_SUFFIX}`, 'g')

function maskCodeFences(text: string): { text: string; fences: string[] } {
  const fences: string[] = []
  const masked = text.replace(CODE_FENCE_PATTERN, (fence) => {
    const index = fences.length
    fences.push(fence)
    return `${CODE_FENCE_PLACEHOLDER_PREFIX}${index}${CODE_FENCE_PLACEHOLDER_SUFFIX}`
  })
  return { text: masked, fences }
}

function unmaskCodeFences(text: string, fences: string[]): string {
  return text.replace(CODE_FENCE_PLACEHOLDER, (_, index) => fences[Number(index)] ?? '')
}

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

/** Removes model scratchpad scaffolding from compaction output (see {@link MODEL_SCRATCHPAD_TAG_NAMES}). */
function unwrapWholeSummaryWrapper(text: string): string | null {
  const trimmed = text.trim()
  const opening = /^<summary\b[^>]*>/i.exec(trimmed)
  if (!opening) {
    return null
  }

  const closing = /<\/summary\s*>$/i.exec(trimmed)
  if (!closing || closing.index === undefined) {
    return null
  }

  return trimmed.slice(opening[0].length, closing.index)
}

export function stripModelScratchpadBlocks(raw: string): string {
  const { text: masked, fences } = maskCodeFences(raw)
  let out = stripKnownModelScratchpadBlocks(masked)

  const unwrapped = unwrapWholeSummaryWrapper(out)
  if (unwrapped !== null) {
    out = unwrapped
  }

  out = unmaskCodeFences(out, fences)
  return out.replace(/\n{3,}/g, '\n\n').trim()
}
