import katex from 'katex'

export const COMPOSER_INLINE_MATH_NODE_NAME = 'inlineMath'

/** The complete dollar-delimited source, including `$$` for empty latex. */
export function serializeComposerMath(latex: string): string {
  return `$${latex}$`
}

export type ComposerMathSegment =
  | { type: 'text'; text: string }
  | { type: 'inlineMath'; latex: string; from: number; to: number }

function isEscapedDollar(text: string, position: number): boolean {
  let backslashes = 0
  for (let index = position - 1; index >= 0 && text[index] === '\\'; index -= 1) backslashes += 1
  return backslashes % 2 === 1
}

function findComposerMathCandidatesInRanges(text: string, changedRanges: readonly { from: number; to: number }[]) {
  const variables = [...text.matchAll(/\$\{([^}\r\n]+)\}/g)]
    .filter((match) => match[1].trim())
    .map((match) => ({ from: match.index, to: match.index + match[0].length }))
  const candidates: { from: number; to: number; latex: string }[] = []

  const pattern = /(?<!\$)\$([^$\r\n]+?)\$(?!\$)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const from = match.index
    const to = from + match[0].length
    const latex = match[1]
    if (isEscapedDollar(text, from)) {
      // Only a padded body proves the pair was accidental; `\$x$5` keeps today's consume behaviour.
      const paddedBody = /^\s|\s$/.test(latex)
      if (paddedBody) pattern.lastIndex = to - 1
      continue
    }
    const variable = variables.find((variable) => variable.from < to && variable.to > from)
    if (variable) {
      pattern.lastIndex = variable.to
      continue
    }
    if (!changedRanges.some((range) => range.from <= to && range.to >= from)) continue
    if (isEscapedDollar(text, to - 1)) continue
    if (/^\s|\s$/.test(latex) || /[0-9]/.test(text[to] ?? '')) continue

    try {
      katex.renderToString(latex, {
        displayMode: false,
        throwOnError: true,
        trust: false,
        strict: 'error',
        output: 'htmlAndMathml'
      })
      candidates.push({ from, to, latex })
    } catch {
      // Invalid formulas stay editable as their original source.
    }
  }

  return candidates
}

/** Accepted formula spans, with offsets relative to this continuous text run. */
export function findComposerMathCandidates(text: string): { from: number; to: number; latex: string }[] {
  return findComposerMathCandidatesInRanges(text, [{ from: 0, to: text.length }])
}

/** Convert affected formulas while preserving every character outside their spans. */
export function transformComposerMathTextRun(
  text: string,
  changedRanges: readonly { from: number; to: number }[]
): ComposerMathSegment[] {
  const segments: ComposerMathSegment[] = []
  let cursor = 0

  for (const candidate of findComposerMathCandidatesInRanges(text, changedRanges)) {
    if (candidate.from > cursor) segments.push({ type: 'text', text: text.slice(cursor, candidate.from) })
    segments.push({ type: 'inlineMath', ...candidate })
    cursor = candidate.to
  }

  if (cursor < text.length) segments.push({ type: 'text', text: text.slice(cursor) })
  return segments
}
