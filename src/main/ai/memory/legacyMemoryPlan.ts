import type { Nodes } from 'mdast'

import {
  assertMemoryContent,
  MEMORY_ENTRY,
  MEMORY_MAX_BYTES,
  MEMORY_MAX_LINES,
  MemoryError,
  memoryLineCount
} from './memoryFiles'

export async function planLegacyMemory(
  source: string,
  currentEntry: string,
  sourceHash: string
): Promise<Map<string, string>> {
  const { fromMarkdown } = await import('mdast-util-from-markdown')
  let hasReferences = false
  const inspect = (node: Nodes): void => {
    if (node.type === 'linkReference' || node.type === 'imageReference') hasReferences = true
    if (
      ('url' in node && !/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(node.url)) ||
      (node.type === 'html' && /\b(?:href|src)\s*=/i.test(node.value)) ||
      (node.type === 'text' && /\[\[/.test(node.value))
    )
      throw new MemoryError(
        'conflict',
        'Legacy FACT links require manual review before relocation or section splitting'
      )
    if ('children' in node) for (const child of node.children) inspect(child)
  }
  const document = fromMarkdown(source)
  inspect(document)
  const files = new Map<string, string>()
  const join = (left: string, right: string) => (left ? `${left}\n\n${right}` : right)
  if (!source.trim() || currentEntry.includes(source)) return new Map([[MEMORY_ENTRY, currentEntry]])
  const combined = join(currentEntry, source)
  if (Buffer.byteLength(combined, 'utf8') <= MEMORY_MAX_BYTES && memoryLineCount(combined) <= MEMORY_MAX_LINES)
    return new Map([[MEMORY_ENTRY, combined]])

  if (hasReferences)
    throw new MemoryError('conflict', 'Legacy FACT references require manual review before section splitting')

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
  // Slice the original text at parsed headings so fenced code, comments and other blocks stay intact.
  const boundaries = document.children.flatMap((node) =>
    node.type === 'heading' && node.depth === 1 && node.position?.start.offset !== undefined
      ? [node.position.start.offset]
      : []
  )
  let start = 0
  for (const end of [...boundaries, source.length]) {
    if (end === start) continue
    const section = source.slice(start, end)
    start = end
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
