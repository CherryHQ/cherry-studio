/** Verifies doc frontmatter: every reference doc names its subject (description) and where that code lives (sources, existence-checked). */
import * as fs from 'fs'
import matter from 'gray-matter'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '..')

export type FrontmatterRule = { requireSources: boolean }

export const listMarkdownFiles = (dir: string): string[] => {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listMarkdownFiles(full))
    else if (entry.name.endsWith('.md')) files.push(full)
  }
  return files.sort()
}

export const checkFile = (repoRoot: string, filePath: string, rule: FrontmatterRule): string[] => {
  const failures: string[] = []
  const rel = path.relative(repoRoot, filePath)
  const { data } = matter(fs.readFileSync(filePath, 'utf8'))

  const description = data.description
  if (typeof description !== 'string' || description.trim() === '') {
    failures.push(`${rel}: missing frontmatter \`description\``)
  } else if (description.includes('\n')) {
    failures.push(`${rel}: \`description\` must be a single line`)
  }

  const sources = data.sources
  if (sources === undefined) {
    if (rule.requireSources) {
      failures.push(`${rel}: missing frontmatter \`sources\` (code paths this doc describes)`)
    }
  } else if (!Array.isArray(sources) || sources.length === 0 || sources.some((s) => typeof s !== 'string')) {
    failures.push(`${rel}: \`sources\` must be a non-empty list of repo-relative paths`)
  } else {
    for (const source of sources) {
      // Diff paths are non-empty and repo-relative, so invalid entries can never match one.
      if (source.trim() === '' || path.isAbsolute(source) || source.split(/[/\\]/).includes('..')) {
        failures.push(`${rel}: \`sources\` entry is not repo-relative: ${source}`)
      } else if (!fs.existsSync(path.join(repoRoot, source))) {
        failures.push(`${rel}: source path does not exist: ${source} — the doc may describe deleted or moved code`)
      }
    }
  }

  return failures
}

export const checkDocsFrontmatter = (repoRoot: string): string[] => {
  const failures: string[] = []
  for (const file of listMarkdownFiles(path.join(repoRoot, 'docs/references'))) {
    failures.push(...checkFile(repoRoot, file, { requireSources: true }))
  }
  for (const file of listMarkdownFiles(path.join(repoRoot, 'docs/contrib'))) {
    failures.push(...checkFile(repoRoot, file, { requireSources: false }))
  }
  return failures
}

const main = () => {
  const failures = checkDocsFrontmatter(ROOT)
  if (failures.length > 0) {
    console.error(`Found ${failures.length} doc frontmatter violation(s):\n`)
    for (const failure of failures) console.error(`  ${failure}`)
    process.exit(1)
  }
  console.log('Doc frontmatter OK.')
}

if (require.main === module) main()
