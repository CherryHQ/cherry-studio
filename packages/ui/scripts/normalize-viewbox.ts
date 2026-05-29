/**
 * Normalize SVG width/height to 32x32.
 *
 * Updates the width and height attributes on the <svg> tag to 32,
 * keeping the viewBox unchanged so SVG content scales naturally.
 *
 * Usage:
 *   pnpm tsx scripts/normalize-viewbox.ts --dir=providers
 *   pnpm tsx scripts/normalize-viewbox.ts --dir=models
 *   pnpm tsx scripts/normalize-viewbox.ts --dir=providers --dry-run
 */
import fs from 'fs/promises'
import path from 'path'

const TARGET_SIZE = 32

type SourceDir = 'providers' | 'models'

function parseArgs(): { dir: SourceDir; dryRun: boolean } {
  const dirArg = process.argv.find((a) => a.startsWith('--dir='))
  const dir = (dirArg?.split('=')[1] as SourceDir) || 'providers'
  const dryRun = process.argv.includes('--dry-run')
  return { dir, dryRun }
}

function normalizeSvg(content: string): { result: string; changed: boolean; reason?: string } {
  const svgTagMatch = content.match(/<svg([^>]*)>/s)
  if (!svgTagMatch) {
    return { result: content, changed: false, reason: 'no <svg> tag' }
  }

  let attrs = svgTagMatch[1]
  let changed = false

  // Update width
  const wMatch = attrs.match(/\bwidth="([^"]*)"/)
  if (wMatch && wMatch[1] !== String(TARGET_SIZE)) {
    attrs = attrs.replace(/\bwidth="[^"]*"/, `width="${TARGET_SIZE}"`)
    changed = true
  } else if (!wMatch) {
    attrs += ` width="${TARGET_SIZE}"`
    changed = true
  }

  // Update height
  const hMatch = attrs.match(/\bheight="([^"]*)"/)
  if (hMatch && hMatch[1] !== String(TARGET_SIZE)) {
    attrs = attrs.replace(/\bheight="[^"]*"/, `height="${TARGET_SIZE}"`)
    changed = true
  } else if (!hMatch) {
    attrs += ` height="${TARGET_SIZE}"`
    changed = true
  }

  if (!changed) {
    return { result: content, changed: false, reason: 'already 32x32' }
  }

  const result = content.replace(/<svg[^>]*>/s, `<svg${attrs}>`)
  return { result, changed: true }
}

async function main() {
  const { dir, dryRun } = parseArgs()
  const baseDir = path.join(__dirname, '../icons', dir)

  console.log(
    `Normalizing SVG dimensions to ${TARGET_SIZE}x${TARGET_SIZE} (source: ${dir})${dryRun ? ' [DRY RUN]' : ''}...\n`
  )

  let files: string[]
  try {
    files = (await fs.readdir(baseDir)).filter((f) => f.endsWith('.svg')).sort()
  } catch {
    console.error(`Directory not found: ${baseDir}`)
    process.exit(1)
  }

  if (files.length === 0) {
    console.log('No SVG files found.')
    return
  }

  console.log(`Found ${files.length} SVG files\n`)

  let changedCount = 0
  let skippedCount = 0

  for (const file of files) {
    const filePath = path.join(baseDir, file)
    const content = await fs.readFile(filePath, 'utf-8')
    const { result, changed, reason } = normalizeSvg(content)

    if (changed) {
      if (!dryRun) {
        await fs.writeFile(filePath, result, 'utf-8')
      }
      console.log(`  + ${file}${dryRun ? ' (would change)' : ''}`)
      changedCount++
    } else {
      console.log(`  - ${file} (skipped: ${reason})`)
      skippedCount++
    }
  }

  console.log(`\nDone: ${changedCount} changed, ${skippedCount} skipped`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
