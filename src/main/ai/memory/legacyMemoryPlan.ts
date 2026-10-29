import {
  assertMemoryContent,
  MEMORY_ENTRY,
  MEMORY_MAX_BYTES,
  MEMORY_MAX_LINES,
  MemoryError,
  memoryLineCount
} from './memoryFiles'

/** Keep complete top-level Markdown sections intact; never split a fact or a fenced block to fit. */
function sections(content: string): string[] {
  const result: string[] = []
  let current = ''
  let fence: { character: string; length: number } | undefined
  for (const line of content.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    if (!fence && /^ {0,3}#(?:\s|$)/.test(line) && current) {
      result.push(current)
      current = ''
    }
    current += line
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.trimEnd())
    if (marker) {
      if (!fence) fence = { character: marker[1][0], length: marker[1].length }
      else if (marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim())
        fence = undefined
    }
  }
  if (current) result.push(current)
  return result
}

export function planLegacyMemory(source: string, currentEntry: string, sourceHash: string): Map<string, string> {
  const files = new Map<string, string>()
  const join = (left: string, right: string) => (left ? `${left}\n\n${right}` : right)
  if (!source.trim() || currentEntry.includes(source)) return new Map([[MEMORY_ENTRY, currentEntry]])
  const combined = join(currentEntry, source)
  if (Buffer.byteLength(combined, 'utf8') <= MEMORY_MAX_BYTES && memoryLineCount(combined) <= MEMORY_MAX_LINES)
    return new Map([[MEMORY_ENTRY, combined]])

  let entry = currentEntry
  let topic = ''
  let topicNumber = 0
  let inTopics = false
  const prefix = `legacy-${sourceHash.slice(0, 12)}`
  const flush = () => {
    if (!topic) return
    files.set(`.memories/${prefix}-${++topicNumber}.md`, topic)
    topic = ''
  }
  for (const section of sections(source)) {
    if (Buffer.byteLength(section, 'utf8') > MEMORY_MAX_BYTES)
      throw new MemoryError('limit', 'A legacy FACT section is too large to migrate without splitting its context')
    const candidate = join(entry, section)
    if (
      !inTopics &&
      Buffer.byteLength(candidate, 'utf8') <= MEMORY_MAX_BYTES - 512 &&
      memoryLineCount(candidate) <= MEMORY_MAX_LINES - 8
    ) {
      entry = candidate
    } else {
      inTopics = true
      if (Buffer.byteLength(topic + section, 'utf8') > MEMORY_MAX_BYTES) flush()
      topic += section
    }
  }
  flush()
  let links = [...files.keys()].map((target, index) => `- [Legacy facts ${index + 1}](${target})`).join('\n')
  const linkedEntry = join(entry, links)
  if (Buffer.byteLength(linkedEntry, 'utf8') > MEMORY_MAX_BYTES || memoryLineCount(linkedEntry) > MEMORY_MAX_LINES) {
    const indices: string[] = []
    let indexContent = ''
    const flushIndex = () => {
      if (!indexContent) return
      const target = `.memories/${prefix}-index-${indices.length + 1}.md`
      files.set(target, indexContent)
      indices.push(`- [Legacy facts index ${indices.length + 1}](${target})`)
      indexContent = ''
    }
    for (const line of links.split('\n')) {
      const relativeLine = line.replace('(.memories/', '(') + '\n'
      if (Buffer.byteLength(indexContent + relativeLine, 'utf8') > MEMORY_MAX_BYTES) flushIndex()
      indexContent += relativeLine
    }
    flushIndex()
    links = indices.join('\n')
  }
  files.set(MEMORY_ENTRY, join(entry, links))
  for (const [target, content] of files) assertMemoryContent(target, content)
  return files
}
