import * as fs from 'fs'
import * as path from 'path'

/**
 * Checks all internal markdown links in docs/ and src/ README files.
 * Validates that relative links point to existing files.
 * Exits with code 1 if any broken links are found.
 */

const ROOT = path.resolve(__dirname, '..')

// Markdown link pattern: [text](url) — exclude external URLs and anchors-only
const LINK_RE = /\[(?:[^\]]*)\]\(([^)]+)\)/g

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

function checkFile(filePath: string): BrokenLink[] {
  const broken: BrokenLink[] = []
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const dir = path.dirname(filePath)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let match: RegExpExecArray | null

    LINK_RE.lastIndex = 0
    while ((match = LINK_RE.exec(line)) !== null) {
      const rawLink = match[1]

      // Skip external links, anchors, special protocols, and placeholder links
      if (isExternalLink(rawLink) || isAnchorOnly(rawLink)) continue
      if (rawLink.includes('<') || rawLink.includes('>')) continue

      // Strip anchor fragment from link
      const linkPath = rawLink.split('#')[0]
      if (!linkPath) continue // Was just an anchor

      const resolved = path.resolve(dir, linkPath)

      if (!fs.existsSync(resolved)) {
        broken.push({
          file: path.relative(ROOT, filePath),
          line: i + 1,
          link: rawLink,
          resolvedPath: path.relative(ROOT, resolved)
        })
      }
    }
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

main()
