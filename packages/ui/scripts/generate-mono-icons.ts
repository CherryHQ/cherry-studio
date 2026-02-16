/**
 * Generate Mono versions of all icon components
 *
 * This script reads source SVGs from icons/{providers,models}/ and uses
 * SVGR with custom svgo plugins (removeBackground + convertToMono) to produce:
 *   - {type}/{name}/mono.tsx   — mono component (currentColor)
 *   - {type}/{name}/index.ts   — compound export (Color + Mono + colorPrimary)
 *   - {type}/index.ts          — barrel export
 *
 * Usage:
 *   pnpm tsx scripts/generate-mono-icons.ts --type=providers
 *   pnpm tsx scripts/generate-mono-icons.ts --type=models
 */

import { transform } from '@svgr/core'
import * as fs from 'fs'
import * as path from 'path'

import { colorToLuminance } from './svg-utils'
import { createConvertToMonoPlugin } from './svgo-convert-to-mono'
import { createRemoveBackgroundPlugin } from './svgo-remove-background'

type MonoType = 'providers' | 'models'

function parseTypeArg(): MonoType {
  const arg = process.argv.find((item) => item.startsWith('--type='))
  if (!arg) return 'providers'
  const value = arg.split('=')[1]
  if (value === 'providers' || value === 'models') return value
  throw new Error(`Invalid --type value: ${value}. Use "providers" or "models".`)
}

/** Component output directories (where color.tsx already exists). */
const OUTPUT_DIR_MAP: Record<MonoType, string> = {
  providers: path.join(__dirname, '../src/components/icons/providers'),
  models: path.join(__dirname, '../src/components/icons/models')
}

/** Source SVG directories. */
const SVG_SOURCE_MAP: Record<MonoType, string> = {
  providers: path.join(__dirname, '../icons/providers'),
  models: path.join(__dirname, '../icons/models')
}

/**
 * Convert kebab-case filename to camelCase directory name.
 * Must match the logic in generate-icons.ts.
 */
function toCamelCase(filename: string): string {
  const name = filename.replace(/\.svg$/, '')
  const parts = name.split('-')
  if (parts.length === 1) return parts[0]
  return (
    parts[0] +
    parts
      .slice(1)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('')
  )
}

/**
 * Build a lookup map: dirName → source SVG path.
 */
function buildSvgMap(type: MonoType): Map<string, string> {
  const svgDir = SVG_SOURCE_MAP[type]
  const map = new Map<string, string>()
  if (!fs.existsSync(svgDir)) return map

  for (const file of fs.readdirSync(svgDir)) {
    if (!file.endsWith('.svg')) continue
    const dirName = toCamelCase(file)
    map.set(dirName, path.join(svgDir, file))
  }
  return map
}

/**
 * Ensure SVG has a viewBox attribute.
 */
function ensureViewBox(svgCode: string): string {
  if (/viewBox\s*=\s*"[^"]*"/.test(svgCode)) return svgCode

  const widthMatch = svgCode.match(/<svg[^>]*\bwidth="(\d+(?:\.\d+)?)"/)
  const heightMatch = svgCode.match(/<svg[^>]*\bheight="(\d+(?:\.\d+)?)"/)

  if (widthMatch && heightMatch) {
    return svgCode.replace(/<svg\b/, `<svg viewBox="0 0 ${widthMatch[1]} ${heightMatch[1]}"`)
  }
  return svgCode
}

/**
 * Check if content is an image-based icon (embedded PNG/JPEG data).
 */
function isImageBased(content: string): boolean {
  return content.includes('<image') || content.includes('data:image')
}

/**
 * Generate a mono.tsx file from a source SVG using SVGR with custom svgo plugins.
 * Returns the generated TSX code, or null if the icon can't be converted.
 */
async function generateMono(svgPath: string, monoName: string): Promise<string | null> {
  const svgCode = fs.readFileSync(svgPath, 'utf-8')

  if (isImageBased(svgCode)) {
    return null
  }

  const processedSvg = ensureViewBox(svgCode)

  // Both plugins run in sequence during the same svgo optimize() call.
  // The convertToMono plugin needs to know if a dark background was removed.
  // We use a getter so the mono plugin reads bg state lazily (after bg plugin runs).
  const bgPlugin = createRemoveBackgroundPlugin()

  const monoPlugin = createConvertToMonoPlugin({
    get backgroundWasDark() {
      const fill = bgPlugin.getBackgroundFill()
      const lum = fill ? colorToLuminance(fill) : -1
      return bgPlugin.wasRemoved() && lum >= 0 && lum < 0.3
    }
  })

  let jsCode = await transform(
    processedSvg,
    {
      plugins: ['@svgr/plugin-svgo', '@svgr/plugin-jsx', '@svgr/plugin-prettier'],
      icon: true,
      typescript: true,
      jsxRuntime: 'automatic',
      svgoConfig: {
        plugins: [
          bgPlugin.plugin,
          monoPlugin.plugin,
          {
            name: 'preset-default',
            params: {
              overrides: {
                removeViewBox: false,
                convertPathData: false
              }
            }
          }
        ]
      }
    },
    { componentName: monoName }
  )

  // Add IconComponent type + named/default exports
  jsCode = jsCode.replace(
    `import type { SVGProps } from "react";`,
    `import type { SVGProps } from "react";\nimport type { IconComponent } from '../../types'`
  )
  jsCode = jsCode.replace(`const ${monoName} =`, `const ${monoName}: IconComponent =`)
  jsCode = jsCode.replace(`export default ${monoName};`, `export { ${monoName} };\nexport default ${monoName};`)

  return jsCode
}

// ──────────────────────────────────────────────────────────
// Directory management (kept from original)
// ──────────────────────────────────────────────────────────

/**
 * Parse the actual exported component name from color.tsx.
 */
function getComponentName(baseDir: string, dirName: string): string {
  const colorPath = path.join(baseDir, dirName, 'color.tsx')
  try {
    const content = fs.readFileSync(colorPath, 'utf-8')
    const match = content.match(/export \{ (\w+) \}/)
    if (match) return match[1]
  } catch {
    /* fallback */
  }
  return dirName.charAt(0).toUpperCase() + dirName.slice(1)
}

/**
 * Collect all subdirectories that contain color.tsx.
 */
function collectIconDirs(baseDir: string): string[] {
  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(baseDir, e.name, 'color.tsx')))
    .map((e) => e.name)
    .sort()
}

/**
 * Read colorPrimary from an icon's meta.ts.
 */
function readColorPrimary(baseDir: string, dirName: string): string {
  const metaPath = path.join(baseDir, dirName, 'meta.ts')
  if (!fs.existsSync(metaPath)) return '#000000'
  const content = fs.readFileSync(metaPath, 'utf-8')
  const match = content.match(/colorPrimary:\s*'([^']+)'/)
  return match ? match[1] : '#000000'
}

/**
 * Generate per-icon index.ts with compound export.
 */
function generateIconIndex(baseDir: string, dirName: string, hasMono: boolean): void {
  const colorName = getComponentName(baseDir, dirName)
  const monoName = `${colorName}Mono`
  const colorPrimary = readColorPrimary(baseDir, dirName)

  const lines: string[] = []
  lines.push(`import type { CompoundIcon } from '../../types'`)
  lines.push(``)
  lines.push(`import { ${colorName} } from './color'`)
  if (hasMono) {
    lines.push(`import { ${monoName} } from './mono'`)
  }
  lines.push(``)

  const monoRef = hasMono ? monoName : colorName
  lines.push(
    `export const ${colorName}Icon: CompoundIcon = /*#__PURE__*/ Object.assign(${colorName}, { Color: ${colorName}, Mono: ${monoRef}, colorPrimary: '${colorPrimary}' })`
  )
  lines.push(`export default ${colorName}Icon`)
  lines.push(``)

  fs.writeFileSync(path.join(baseDir, dirName, 'index.ts'), lines.join('\n'))
}

/**
 * Generate the barrel index.ts that re-exports all compound icons.
 */
function generateBarrelIndex(baseDir: string, iconDirs: string[], skippedDirs: Set<string>): void {
  const lines: string[] = []

  lines.push(`/**`)
  lines.push(` * Auto-generated compound icon exports`)
  lines.push(` * Each icon supports: <Icon /> (Color default), <Icon.Color />, <Icon.Mono />, Icon.colorPrimary`)
  lines.push(` * Do not edit manually`)
  lines.push(` *`)
  lines.push(` * Generated at: ${new Date().toISOString()}`)
  lines.push(` * Total icons: ${iconDirs.length}`)
  if (skippedDirs.size > 0) {
    lines.push(` * Image-based icons (Mono = Color fallback): ${[...skippedDirs].join(', ')}`)
  }
  lines.push(` */`)
  lines.push(``)

  for (const dirName of iconDirs) {
    const colorName = getComponentName(baseDir, dirName)
    lines.push(`export { ${colorName}Icon as ${colorName} } from './${dirName}'`)
  }
  lines.push(``)

  fs.writeFileSync(path.join(baseDir, 'index.ts'), lines.join('\n'))
  console.log(
    `\nGenerated index.ts with ${iconDirs.length} compound exports (${skippedDirs.size} image-based fallbacks)`
  )
}

// ──────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────

async function main() {
  const monoType = parseTypeArg()
  const baseDir = OUTPUT_DIR_MAP[monoType]
  const svgMap = buildSvgMap(monoType)

  console.log(`Generating mono icons (type: ${monoType})...\n`)

  const iconDirs = collectIconDirs(baseDir)
  const skippedDirs = new Set<string>()

  let generated = 0
  for (const dirName of iconDirs) {
    const svgPath = svgMap.get(dirName)
    const colorName = getComponentName(baseDir, dirName)
    const monoName = `${colorName}Mono`
    const monoPath = path.join(baseDir, dirName, 'mono.tsx')

    if (!svgPath || !fs.existsSync(svgPath)) {
      // No source SVG — skip mono generation
      console.log(`  ${dirName}/: no source SVG found, skipping mono`)
      skippedDirs.add(dirName)
      if (fs.existsSync(monoPath)) fs.unlinkSync(monoPath)
      generateIconIndex(baseDir, dirName, false)
      continue
    }

    try {
      const monoCode = await generateMono(svgPath, monoName)
      if (monoCode === null) {
        console.log(`  ${dirName}/: image-based icon, skipping mono`)
        skippedDirs.add(dirName)
        if (fs.existsSync(monoPath)) fs.unlinkSync(monoPath)
        generateIconIndex(baseDir, dirName, false)
        continue
      }

      fs.writeFileSync(monoPath, monoCode)
      console.log(`  ${dirName}/ -> ${monoName}`)
      generated++
      generateIconIndex(baseDir, dirName, true)
    } catch (error) {
      console.error(`  Failed to generate mono for ${dirName}:`, error)
      skippedDirs.add(dirName)
      generateIconIndex(baseDir, dirName, false)
    }
  }

  generateBarrelIndex(baseDir, iconDirs, skippedDirs)

  console.log(`\nDone! Generated ${generated} mono icons, skipped ${skippedDirs.size} icons`)
}

main()
