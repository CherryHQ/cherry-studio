/**
 * Generate Mono versions of all logo icons
 *
 * This script:
 * 1. Reads all icons from src/components/icons/logos/
 * 2. Converts all fill colors to "currentColor"
 * 3. Removes gradient/pattern definitions (they're not needed for mono)
 * 4. Outputs to src/components/icons/logos-mono/
 * 5. Generates compound logos/index.ts with .Color and .Mono sub-components
 *
 * Usage: pnpm tsx scripts/generate-mono-icons.ts
 */

import * as fs from 'fs'
import * as path from 'path'

const LOGOS_DIR = path.join(__dirname, '../src/components/icons/logos')
const MONO_DIR = path.join(__dirname, '../src/components/icons/logos-mono')

// Ensure output directory exists
if (!fs.existsSync(MONO_DIR)) {
  fs.mkdirSync(MONO_DIR, { recursive: true })
}

function isBackgroundPath(pathD: string): boolean {
  // Heuristics to detect background shapes:
  // 1. Rounded rectangles that fill the viewBox (like "M18 0H6C2.68629...")
  // 2. Simple rectangles
  const backgroundPatterns = [
    /^M\d+\s+0H\d+C/, // Starts with rounded rect from top-left
    /^M0\s+\d+C/, // Starts from left edge with curve
    /^M0\s+0[HVhv]/, // Simple rect from origin
    /^M\d+\s+\d+H\d+V\d+H\d+V\d+Z?$/i // Simple rect pattern
  ]

  return backgroundPatterns.some((p) => p.test(pathD.trim()))
}

function convertToMono(content: string, _filename: string): string {
  let result = content

  // Strategy for mono icons:
  // 1. Remove background paths (large rectangles)
  // 2. Convert all remaining fills to currentColor
  // 3. Remove gradients/patterns

  // First, identify and mark background paths for removal
  // A background path is typically the first path that covers the whole viewBox
  const pathMatches = [...content.matchAll(/<path[^>]*d="([^"]+)"[^>]*>/g)]

  if (pathMatches.length > 1) {
    // Multiple paths - check if first one is a background
    const firstPathD = pathMatches[0][1]
    if (isBackgroundPath(firstPathD)) {
      // Remove the first path (background)
      result = result.replace(pathMatches[0][0], '')
    }
  }

  // Replace all fill="..." with fill="currentColor"
  // Skip fill="none"
  result = result.replace(/fill="(?!none")[^"]+"/g, (match) => {
    if (match === 'fill="none"') return match
    return 'fill="currentColor"'
  })

  // Remove <defs>...</defs> sections (gradients, patterns, clipPaths)
  result = result.replace(/<defs>[\s\S]*?<\/defs>/g, '')

  // Remove clipPath references
  result = result.replace(/clipPath="url\([^)]+\)"/g, '')

  // Clean up empty <g> tags
  result = result.replace(/<g\s*>\s*<\/g>/g, '')
  result = result.replace(/<g\s+>/g, '<g>')

  // Remove duplicate fill attributes
  result = result.replace(/(fill="currentColor"\s*)+/g, 'fill="currentColor" ')

  // Clean up extra whitespace
  result = result.replace(/\n\s*\n/g, '\n')

  return result
}

/**
 * Special mappings for files that start with numbers or have non-standard naming
 * The key is the filename (without .tsx), the value is the component name
 */
const SPECIAL_NAME_MAPPINGS: Record<string, string> = {
  '302ai': 'Ai302'
}

function getComponentName(filename: string): string {
  // Convert filename to PascalCase component name
  const baseName = path.basename(filename, '.tsx')

  // Check for special mappings (files starting with numbers, etc.)
  if (SPECIAL_NAME_MAPPINGS[baseName]) {
    return SPECIAL_NAME_MAPPINGS[baseName]
  }

  return baseName.charAt(0).toUpperCase() + baseName.slice(1)
}

function processIcon(filename: string): void {
  const inputPath = path.join(LOGOS_DIR, filename)
  const outputPath = path.join(MONO_DIR, filename)

  const content = fs.readFileSync(inputPath, 'utf-8')
  const monoContent = convertToMono(content, filename) // filename used for debugging

  // Update component name to add "Mono" suffix
  const originalName = getComponentName(filename)
  const monoName = `${originalName}Mono`

  const finalContent = monoContent
    // Update component declaration
    .replace(new RegExp(`const ${originalName} =`), `const ${monoName} =`)
    // Update export
    .replace(new RegExp(`export \\{ ${originalName} \\}`), `export { ${monoName} }`)
    .replace(new RegExp(`export default ${originalName}`), `export default ${monoName}`)

  fs.writeFileSync(outputPath, finalContent)
  console.log(`✓ ${filename} -> ${monoName}`)
}

/**
 * Generate the compound logos/index.ts barrel.
 *
 * Each exported icon is a compound component:
 *   <Icon />        — Color (default)
 *   <Icon.Color />  — Color (explicit)
 *   <Icon.Mono />   — Mono (currentColor)
 *
 * Uses `#__PURE__` annotation so bundlers can tree-shake unused icons.
 */
function generateCompoundIndex(): void {
  const files = fs
    .readdirSync(LOGOS_DIR)
    .filter((f) => f.endsWith('.tsx') && f !== 'index.ts')
    .sort()

  const lines: string[] = []

  lines.push(`/**`)
  lines.push(` * Auto-generated compound icon exports`)
  lines.push(` * Each icon supports: <Icon /> (Color default), <Icon.Color />, <Icon.Mono />`)
  lines.push(` * Do not edit manually`)
  lines.push(` *`)
  lines.push(` * Generated at: ${new Date().toISOString()}`)
  lines.push(` * Total icons: ${files.length}`)
  lines.push(` */`)
  lines.push(``)

  for (const f of files) {
    const baseName = path.basename(f, '.tsx')
    const colorName = getComponentName(f)
    const monoName = `${colorName}Mono`

    lines.push(`import { ${colorName} as _${colorName} } from './${baseName}'`)
    lines.push(`import { ${monoName} as _${monoName} } from '../logos-mono/${baseName}'`)
    lines.push(
      `export const ${colorName} = /*#__PURE__*/ Object.assign(_${colorName}, { Color: _${colorName}, Mono: _${monoName} })`
    )
    lines.push(``)
  }

  fs.writeFileSync(path.join(LOGOS_DIR, 'index.ts'), lines.join('\n'))
  console.log(`\n✓ Generated logos/index.ts with ${files.length} compound exports`)
}

/**
 * Remove the old logos-mono/index.ts barrel (no longer needed —
 * mono icons are accessed via <Icon.Mono />).
 */
function cleanupOldMonoIndex(): void {
  const oldIndex = path.join(MONO_DIR, 'index.ts')
  if (fs.existsSync(oldIndex)) {
    fs.unlinkSync(oldIndex)
    console.log(`✓ Removed old logos-mono/index.ts`)
  }
}

// Main
console.log('Generating mono icons...\n')

const files = fs.readdirSync(LOGOS_DIR).filter((f) => f.endsWith('.tsx') && f !== 'index.ts')

for (const file of files) {
  processIcon(file)
}

generateCompoundIndex()
cleanupOldMonoIndex()

console.log(`\nDone! Generated ${files.length} mono icons in ${MONO_DIR}`)
