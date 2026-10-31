/** Enforce lifecycle-specific Agent Note paths, headers, and sections. */
import * as fs from 'fs'
import * as path from 'path'

import type { ListItem, Paragraph, Root, RootContent } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import type { Node, Parent } from 'unist'

const ROOT = path.resolve(__dirname, '../..')
const CLASSES = new Set(['feature', 'bug-fix', 'simplification', 'architecture', 'process', 'testing'])
const LIFECYCLES = new Set(['proposed', 'implemented', 'rejected'])
const NOTE_NAME = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/
const ACCEPTANCE_ENTRY = /^- (AC\d+) — \S.*$/u
const ACCEPTANCE_CRITERION = /^- (AC\d+) — \S.*\(verification: [^)]+\)$/u
const VERIFICATION_ENTRY = /^- (AC\d+|Regression) — \S.*$/u
const ACCEPTANCE_HEADING = '## Acceptance criteria'
const VERIFICATION_HEADING = '## Verification'

interface ParsedEntries {
  ids: string[]
  malformed: string[]
  invalidFormat: string[]
  hasRegression: boolean
  hasListItems: boolean
}

export interface ParsedAgentNote {
  headings: string[]
  acceptanceCriteria: ParsedEntries
  verification: ParsedEntries
}

const nodeSource = (content: string, node: Node): string => {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  return start === undefined || end === undefined ? '' : content.slice(start, end)
}

const visibleText = (node: Node): string => {
  if (node.type === 'text' || node.type === 'inlineCode') {
    return 'value' in node && typeof node.value === 'string' ? node.value : ''
  }
  if (!('children' in node)) return ''
  return (node as Parent).children.map(visibleText).join('')
}

const parseSections = (content: string, root: Root): { headings: string[]; sections: Map<string, RootContent[]> } => {
  const headings: string[] = []
  const sections = new Map<string, RootContent[]>()
  for (let index = 0; index < root.children.length; index += 1) {
    const node = root.children[index]
    if (node.type !== 'heading' || node.depth !== 2) continue
    const heading = nodeSource(content, node).trimEnd()
    headings.push(heading)
    let end = index + 1
    while (end < root.children.length) {
      const candidate = root.children[end]
      if (candidate.type === 'heading' && candidate.depth === 2) break
      end += 1
    }
    sections.set(heading, [...(sections.get(heading) ?? []), ...root.children.slice(index + 1, end)])
  }
  return { headings, sections }
}

const collectListItems = (nodes: RootContent[]): ListItem[] => {
  const items: ListItem[] = []
  const walk = (node: Node): void => {
    if (node.type === 'listItem') items.push(node as ListItem)
    if ('children' in node) for (const child of (node as Parent).children) walk(child)
  }
  for (const node of nodes) walk(node)
  return items
}

const entryParagraph = (item: ListItem): Paragraph | undefined =>
  item.children.find((child): child is Paragraph => child.type === 'paragraph')

const parseEntries = (content: string, nodes: RootContent[], kind: 'acceptance' | 'verification'): ParsedEntries => {
  const ids: string[] = []
  const malformed: string[] = []
  const invalidFormat: string[] = []
  let hasRegression = false
  const listItems = collectListItems(nodes)
  const rootItems = new Set(nodes.flatMap((node) => (node.type === 'list' ? node.children : [])))
  for (const item of listItems) {
    const paragraph = entryParagraph(item)
    if (!paragraph) continue
    const labelPattern = kind === 'acceptance' ? /^(AC\d+)\b/u : /^(AC\d+|Regression)\b/u
    const entryText = visibleText(paragraph)
      .trimStart()
      .replace(/^\[[ xX]\]\s+/u, '')
    const label = labelPattern.exec(entryText)?.[1]
    if (!label) continue
    if (!rootItems.has(item)) {
      malformed.push(label)
      continue
    }
    const source = content.slice(item.position?.start.offset ?? 0, paragraph.position?.end.offset ?? 0)
    const entry = kind === 'acceptance' ? ACCEPTANCE_ENTRY.exec(source)?.[1] : VERIFICATION_ENTRY.exec(source)?.[1]
    if (!entry) {
      malformed.push(label)
      continue
    }
    if (kind === 'acceptance' && !ACCEPTANCE_CRITERION.test(source)) invalidFormat.push(label)
    if (entry === 'Regression') hasRegression = true
    else ids.push(entry)
  }
  return { ids, malformed, invalidFormat, hasRegression, hasListItems: listItems.length > 0 }
}

export const parseAgentNote = (content: string): ParsedAgentNote => {
  const tree = unified().use(remarkParse).parse(content)
  const { headings, sections } = parseSections(content, tree)
  return {
    headings,
    acceptanceCriteria: parseEntries(content, sections.get(ACCEPTANCE_HEADING) ?? [], 'acceptance'),
    verification: parseEntries(content, sections.get(VERIFICATION_HEADING) ?? [], 'verification')
  }
}

export const checkAgentNote = (relative: string, content: string): string[] => {
  const errors: string[] = []
  const parts = relative.split('/')
  const [lifecycle, noteClass, filename] = parts.slice(-3)
  if (!lifecycle || !LIFECYCLES.has(lifecycle))
    errors.push('path must use proposed, implemented, or rejected lifecycle')
  if (!noteClass || !CLASSES.has(noteClass)) errors.push('path must use a supported Agent Note class')
  if (!filename || !NOTE_NAME.test(filename)) errors.push('filename must be yyyy-mm-dd-kebab-topic.md')

  const lines = content.split('\n')
  const parsed = parseAgentNote(content)
  if (!/^# Agent Note: \S/u.test(lines[0] ?? '')) errors.push('line 1 must be `# Agent Note: <title>`')
  if (lines[1] !== '') errors.push('line 2 must be blank')
  const expectedStatus =
    lifecycle === 'rejected' ? /^Status: rejected — \S/u : new RegExp(`^Status: ${lifecycle}$`, 'u')
  if (!expectedStatus.test(lines[2] ?? '')) errors.push(`line 3 must match the ${lifecycle} status`)
  if (lines[3] !== '') errors.push('line 4 must be blank')

  const headings = parsed.headings
  if (headings[0] !== '## Problem') errors.push('the first section must be `## Problem`')
  const required: Record<string, string[]> = {
    proposed: ['## Proposal', '## Alternatives considered', '## Acceptance criteria', '## Risks'],
    implemented: ['## Decision', '## Alternatives considered', '## Consequences', '## Verification'],
    rejected: ['## Proposal', '## Rejection rationale', '## Alternatives considered']
  }
  for (const heading of required[lifecycle] ?? []) {
    if (!headings.includes(heading)) errors.push(`missing required section ${heading}`)
  }
  if (lifecycle === 'implemented') {
    for (const heading of headings.filter((value) => /^## (?:Proposal|Acceptance criteria|Risks)$/u.test(value))) {
      errors.push(`${heading} is proposal language and is not allowed in implemented notes`)
    }
  }
  if (lifecycle === 'proposed') {
    const criteria = parsed.acceptanceCriteria
    if (criteria.ids.length === 0)
      errors.push('Acceptance criteria must contain `- AC1 — <observable outcome>` entries')
    if (criteria.malformed.length || criteria.invalidFormat.length)
      errors.push('Acceptance criteria entries must match `- AC1 — <observable outcome> (verification: <owner>)`')
    const numbers = criteria.ids.map((id) => Number(/^AC(\d+)$/u.exec(id)?.[1]))
    if (numbers.some((number, index) => number !== index + 1))
      errors.push('Acceptance criteria IDs must be contiguous from AC1')
  }
  if (lifecycle === 'implemented') {
    if (parsed.verification.ids.length === 0 && !parsed.verification.hasRegression) {
      errors.push('Verification must map AC IDs or a direct bug regression to actual evidence')
    }
    if (parsed.verification.malformed.length)
      errors.push('Verification entries must match `- AC1 — <evidence>` or `- Regression — <evidence>`')
  }
  return errors
}

export const checkAgentNotes = (repoRoot: string): string[] => {
  const notesRoot = path.join(repoRoot, '.agents/notes')
  const errors: string[] = []
  for (const entry of fs.readdirSync(notesRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && !LIFECYCLES.has(entry.name))
      errors.push(`.agents/notes/${entry.name}/: unsupported lifecycle`)
  }
  for (const lifecycle of [...LIFECYCLES].sort()) {
    const lifecycleDir = path.join(notesRoot, lifecycle)
    if (!fs.existsSync(lifecycleDir)) continue
    for (const noteClass of fs.readdirSync(lifecycleDir)) {
      if (noteClass === 'AGENTS.md') continue
      const classDir = path.join(lifecycleDir, noteClass)
      if (!fs.statSync(classDir).isDirectory()) {
        errors.push(`${path.relative(repoRoot, classDir)}: lifecycle entries must be class directories`)
        continue
      }
      if (!CLASSES.has(noteClass)) errors.push(`${path.relative(repoRoot, classDir)}: unsupported Agent Note class`)
      for (const filename of fs.readdirSync(classDir)) {
        if (!filename.endsWith('.md') || filename.endsWith('.zh.md') || filename === 'AGENTS.md') continue
        const file = path.join(classDir, filename)
        const relative = path.relative(repoRoot, file).split(path.sep).join('/')
        for (const error of checkAgentNote(relative, fs.readFileSync(file, 'utf8')))
          errors.push(`${relative}: ${error}`)
      }
    }
  }
  return errors
}

const main = (): void => {
  const errors = checkAgentNotes(ROOT)
  if (errors.length) {
    console.error('Agent Note format violations:')
    for (const error of errors) console.error(`  ${error}`)
    process.exitCode = 1
    return
  }
  console.log('Agent Note format OK.')
}

if (require.main === module) main()
