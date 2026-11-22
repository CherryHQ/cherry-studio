const encoder = new TextEncoder()
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
export function terminalTextSuffix(text: string, limit = 64 * 1024): { text: string; truncated: boolean } {
  const bytes = encoder.encode(text)
  if (bytes.length <= limit) return { text, truncated: false }
  const tail = new TextDecoder().decode(bytes.subarray(bytes.length - limit))
  const segments = graphemes.segment(tail)[Symbol.iterator]()
  const first = segments.next().value
  return { text: first ? tail.slice(first.segment.length) : '', truncated: true }
}
