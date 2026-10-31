import * as fs from 'fs'
import * as path from 'path'

/**
 * Checks all internal markdown links in docs/ and src/ README files.
 * Validates that relative links point to existing files.
 * Exits with code 1 if any broken links are found.
 */

const ROOT = path.resolve(__dirname, '../..')

// Markdown link pattern: [text](url) — exclude external URLs and anchors-only
const LINK_RE = /\[(?:[^\]]*)\]\(([^)]+)\)/g

// Reference-style link definition: `[label]: <target>` or `[label]: target` (optional title ignored).
// The bare-target branch is restricted to path-like starts so prose/code such as a JS object
// literal `[key]: {` is not mistaken for a link definition.
const DEF_RE = /^\[([^\]]+)\]:\s*(?:<([^>]+)>|([\w./#~-][^\s]*))/
// Reference-style link usage: `[text][label]` (label may be empty for the collapsed `[text][]` form)
const REF_USE_RE = /\[([^\]]+)\]\[([^\]]*)\]/g

interface BrokenLink {
  file: string
  line: number
  link: string
  resolvedPath: string
}

function findMarkdownFiles(dir: string): string[] {
  const results: string[] = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // Skip node_modules, .git, out, dist
      if (['node_modules', '.git', 'out', 'dist'].includes(entry.name)) continue
      results.push(...findMarkdownFiles(fullPath))
    } else if (entry.name.endsWith('.md')) {
      results.push(fullPath)
    }
  }
  return results
}

function isExternalLink(link: string): boolean {
  return link.startsWith('http://') || link.startsWith('https://') || link.startsWith('mailto:')
}

function isAnchorOnly(link: string): boolean {
  return link.startsWith('#')
}

/**
 * Returns, per input line, whether the line sits inside a fenced code block
 * (opened by a line of 3+ backticks or tildes and closed by a matching line).
 * Lines inside fences are not real Markdown link syntax and must be ignored.
 */
function computeFenced(lines: string[]): boolean[] {
  const fenced: boolean[] = new Array(lines.length).fill(false)
  const fenceRe = /^\s*(`{3,}|~{3,})/
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    if (fenceRe.test(lines[i])) {
      inFence = !inFence
      continue
    }
    fenced[i] = inFence
  }
  return fenced
}

function recordIfBroken(rawLink: string, dir: string, filePath: string, line: number, broken: BrokenLink[]): void {
  // Skip external links, anchors, special protocols, and placeholder links
  if (isExternalLink(rawLink) || isAnchorOnly(rawLink)) return
  if (rawLink.includes('<') || rawLink.includes('>')) return

  // Strip anchor fragment from link
  const linkPath = rawLink.split('#')[0]
  if (!linkPath) return // Was just an anchor

  const resolved = path.resolve(dir, linkPath)

  if (!fs.existsSync(resolved)) {
    broken.push({
      file: path.relative(ROOT, filePath),
      line,
      link: rawLink,
      resolvedPath: path.relative(ROOT, resolved)
    })
  }
}

export function checkFile(filePath: string): BrokenLink[] {
  const broken: BrokenLink[] = []
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const dir = path.dirname(filePath)

  // Lines inside fenced code blocks (``` or ~~~) are not real Markdown link
  // syntax and must be ignored for both definition collection and usage checks.
  const fenced = computeFenced(lines)

  // First pass: collect reference-style definitions (`[label]: target`). Markdown link
  // labels are case-insensitive, so key the map by the lower-cased label.
  const refDefs = new Map<string, { target: string; line: number }>()
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue
    const def = DEF_RE.exec(lines[i])
    if (!def) continue
    const label = def[1].trim().toLowerCase()
    const target = (def[2] ?? def[3] ?? '').trim()
    // CommonMark uses the first definition when a label is declared more than once,
    // so only the first occurrence is recorded.
    if (target && !refDefs.has(label)) refDefs.set(label, { target, line: i + 1 })
  }

  const usedLabels = new Set<string>()

  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue
    const line = lines[i]
    let match: RegExpExecArray | null

    LINK_RE.lastIndex = 0
    while ((match = LINK_RE.exec(line)) !== null) {
      recordIfBroken(match[1], dir, filePath, i + 1, broken)
    }

    REF_USE_RE.lastIndex = 0
    while ((match = REF_USE_RE.exec(line)) !== null) {
      // A reference usage only matters when a matching definition exists; otherwise it is
      // ambiguous (e.g. a regex character class like `[1-9][0-9]` in prose/code) and must not
      // be reported as a broken link.
      const label = (match[2] || match[1]).trim().toLowerCase()
      const def = refDefs.get(label)
      if (!def) continue
      usedLabels.add(label)
      // Report the broken target at the usage line (where the link is written).
      recordIfBroken(def.target, dir, filePath, i + 1, broken)
    }
  }

  // Validate the targets of definitions that were never used (a missing definition target is itself a broken link).
  for (const [label, { target, line }] of refDefs) {
    if (usedLabels.has(label)) continue
    recordIfBroken(target, dir, filePath, line, broken)
  }

  return broken
}

function main() {
  const scanDirs = ['docs', 'src', 'packages', '.agents'].map((d) => path.join(ROOT, d)).filter((d) => fs.existsSync(d))

  let allFiles: string[] = []
  for (const dir of scanDirs) {
    allFiles.push(...findMarkdownFiles(dir))
  }

  // Also check root-level markdown files
  const rootMdFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith('.md') && fs.statSync(path.join(ROOT, f)).isFile())
  allFiles.push(...rootMdFiles.map((f) => path.join(ROOT, f)))

  // Deduplicate
  allFiles = [...new Set(allFiles)]

  console.log(`Checking ${allFiles.length} markdown files for broken links...`)

  const allBroken: BrokenLink[] = []
  for (const file of allFiles) {
    allBroken.push(...checkFile(file))
  }

  if (allBroken.length === 0) {
    console.log('All links are valid.')
    process.exit(0)
  }

  console.error(`\nFound ${allBroken.length} broken link(s):\n`)
  for (const b of allBroken) {
    console.error(`  ${b.file}:${b.line}`)
    console.error(`    Link: ${b.link}`)
    console.error(`    Resolved to: ${b.resolvedPath}\n`)
  }

  process.exit(1)
}

if (require.main === module) main()
