/**
 * Validate SVG source files for the icon system
 *
 * Checks:
 * - Filename follows kebab-case convention
 * - viewBox present (warns if missing — ensureViewBox in generate-icons handles it)
 * - viewBox is square (warns if not)
 * - No embedded raster images (<image> or data:image)
 * - File size < 50KB
 *
 * Usage: pnpm tsx scripts/validate-svgs.ts [--dir=logos|general]
 */
import fs from 'fs/promises'
import path from 'path'

type SourceDir = 'providers' | 'models' | 'general'

function parseArgs(): { dir: SourceDir } {
  const dirArg = process.argv.find((a) => a.startsWith('--dir='))
  const dir = (dirArg?.split('=')[1] as SourceDir) || 'providers'
  return { dir }
}

interface ValidationResult {
  file: string
  errors: string[]
  warnings: string[]
}

const MAX_FILE_SIZE = 50 * 1024 // 50KB

/**
 * Validate that a name follows kebab-case convention.
 * Allows: lowercase letters, digits, hyphens. Must start with letter or digit.
 * Examples: "openai", "aws-bedrock", "302ai"
 */
const KEBAB_CASE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function isKebabCase(name: string): boolean {
  return KEBAB_CASE_RE.test(name)
}

/**
 * Suggest a kebab-case version of a non-conforming name.
 */
function suggestKebabCase(name: string): string {
  return (
    name
      // Insert hyphen before uppercase letters: "aiOnly" -> "ai-Only"
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      // Handle uppercase sequences: "DMXAPI" -> "DMX-API" -> handled below
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
      .toLowerCase()
      // Collapse multiple hyphens
      .replace(/-+/g, '-')
      // Remove leading/trailing hyphens
      .replace(/^-|-$/g, '')
  )
}

async function collectSvgFiles(dir: SourceDir): Promise<string[]> {
  const baseDir = path.join(__dirname, '../icons', dir)
  const files = await fs.readdir(baseDir)
  return files.filter((f) => f.endsWith('.svg')).map((f) => path.join(baseDir, f))
}

async function validateSvg(filePath: string): Promise<ValidationResult> {
  const file = path.relative(path.join(__dirname, '..'), filePath)
  const errors: string[] = []
  const warnings: string[] = []

  // Naming convention check
  const baseName = path.basename(filePath, '.svg')
  if (!isKebabCase(baseName)) {
    warnings.push(`Filename "${baseName}.svg" is not kebab-case. Suggested: "${suggestKebabCase(baseName)}.svg"`)
  }

  const stat = await fs.stat(filePath)
  if (stat.size > MAX_FILE_SIZE) {
    warnings.push(`File size ${(stat.size / 1024).toFixed(1)}KB exceeds ${MAX_FILE_SIZE / 1024}KB limit`)
  }

  const content = await fs.readFile(filePath, 'utf-8')

  // Check for embedded raster images
  if (content.includes('<image') || content.includes('data:image')) {
    warnings.push('Contains embedded raster image — mono conversion will be skipped')
  }

  // Check viewBox
  const viewBoxMatch = content.match(/viewBox="([^"]*)"/)
  if (!viewBoxMatch) {
    warnings.push('Missing viewBox attribute (will be inferred from width/height during generation)')
  } else {
    const parts = viewBoxMatch[1].split(/\s+/).map(Number)
    if (parts.length === 4) {
      const [, , w, h] = parts
      if (Math.abs(w - h) > 0.01) {
        warnings.push(`viewBox is not square: ${w}x${h} (mono icons may look distorted)`)
      }
    }
  }

  // Check for <svg> tag
  if (!/<svg\b/.test(content)) {
    errors.push('Not a valid SVG file — no <svg> tag found')
  }

  return { file, errors, warnings }
}

async function main() {
  const { dir } = parseArgs()
  console.log(`Validating SVG files (source: ${dir})...\n`)

  const files = await collectSvgFiles(dir)
  if (files.length === 0) {
    console.log('No SVG files found.')
    return
  }

  console.log(`Found ${files.length} SVG files\n`)

  const results = await Promise.all(files.map(validateSvg))

  let errorCount = 0
  let warningCount = 0

  for (const result of results) {
    if (result.errors.length === 0 && result.warnings.length === 0) continue

    console.log(`${result.file}:`)
    for (const error of result.errors) {
      console.log(`  ERROR: ${error}`)
      errorCount++
    }
    for (const warning of result.warnings) {
      console.log(`  WARN:  ${warning}`)
      warningCount++
    }
    console.log()
  }

  console.log(`\nValidation complete: ${files.length} files, ${errorCount} errors, ${warningCount} warnings`)

  if (errorCount > 0) {
    process.exit(1)
  }
}

main()
