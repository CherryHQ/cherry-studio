// Majority-vote text direction (sentences → words), adapted from T3 Code (MIT).
// `dir="auto"` only considers the first strong character, so mixed paragraphs
// starting with a Latin word render LTR even when most words are Arabic.
// Code fences, inline code, URLs and link targets are excluded from the vote.

export type TextDirection = 'ltr' | 'rtl' | 'auto'

const STRONG_RTL_PATTERN = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFB4F\uFE70-\uFEFF]/u
const STRONG_LTR_PATTERN = /\p{L}/u
const SENTENCE_SPLIT_PATTERN = /[\n.!?؟…]+/u

function stripExcludedSpans(text: string): string {
  return (
    text
      // Fenced and inline code.
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`\n]+`/g, ' ')
      // Images and link targets (keep the visible link label).
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Bare URLs, autolinks and raw HTML tags.
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
}

// A word votes for the script it contains; non-letter tokens are neutral.
function wordDirection(word: string): TextDirection {
  const rtl = (word.match(/[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFB4F\uFE70-\uFEFF]/gu) ?? [])
    .length
  const ltr = (
    word
      .replace(/[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFB4F\uFE70-\uFEFF]/gu, '')
      .match(/\p{L}/gu) ?? []
  ).length

  if (rtl > ltr) return 'rtl'
  if (ltr > rtl) return 'ltr'
  return 'auto'
}

function firstDirection(text: string): TextDirection {
  for (const char of text) {
    if (STRONG_RTL_PATTERN.test(char)) return 'rtl'
    if (STRONG_LTR_PATTERN.test(char)) return 'ltr'
  }
  return 'auto'
}

function sentenceDirection(sentence: string): TextDirection {
  let rtlWords = 0
  let ltrWords = 0

  for (const word of sentence.split(/\s+/u)) {
    const direction = wordDirection(word)
    if (direction === 'rtl') rtlWords += 1
    else if (direction === 'ltr') ltrWords += 1
  }

  if (rtlWords > ltrWords) return 'rtl'
  if (ltrWords > rtlWords) return 'ltr'
  return firstDirection(sentence)
}

/** Explicit direction for mixed-language prose; `auto` when there is no strong text. */
export function textDirection(text: string): TextDirection {
  const prose = stripExcludedSpans(text)
  let rtlSentences = 0
  let ltrSentences = 0
  let firstSeen: TextDirection = 'auto'

  for (const sentence of prose.split(SENTENCE_SPLIT_PATTERN)) {
    const direction = sentenceDirection(sentence)
    if (direction === 'rtl') rtlSentences += 1
    else if (direction === 'ltr') ltrSentences += 1
    else continue
    if (firstSeen === 'auto') firstSeen = direction
  }

  if (rtlSentences > ltrSentences) return 'rtl'
  if (ltrSentences > rtlSentences) return 'ltr'
  return firstSeen
}
