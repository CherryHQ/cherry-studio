import { isHttpUrl } from '@shared/utils/url'

export interface KnowledgeUrlEntry {
  value: string
  line: number
  index: number
}

export function parseKnowledgeUrls(raw: string): { valid: KnowledgeUrlEntry[]; invalid: KnowledgeUrlEntry[] } {
  const valid: KnowledgeUrlEntry[] = []
  const invalid: KnowledgeUrlEntry[] = []
  let index = 0

  for (const [lineIndex, line] of raw.split(/\r\n?|\n/).entries()) {
    for (const match of line.matchAll(/[^\s,]+/g)) {
      const value = match[0].trim()
      const entry = { value, line: lineIndex + 1, index: ++index }
      if (isHttpUrl(value)) valid.push(entry)
      else invalid.push(entry)
    }
  }

  return { valid, invalid }
}
