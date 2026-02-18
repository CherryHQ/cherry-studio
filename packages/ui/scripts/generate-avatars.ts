/**
 * Generate Avatar components for all icon directories
 *
 * This script creates avatar.tsx for each icon that has a color.tsx,
 * then updates the per-icon index.ts to include the Avatar export.
 *
 * Smart background detection:
 *   - SVGs with a detected background shape → full-bleed Color icon (100% fill)
 *   - SVGs without background → padded Color icon (75%) on neutral bg-background
 *
 * Usage:
 *   pnpm tsx scripts/generate-avatars.ts --type=providers
 *   pnpm tsx scripts/generate-avatars.ts --type=models
 */

import * as fs from 'fs'
import * as path from 'path'
import { type Config, optimize } from 'svgo'

import {
  generateAvatar as codegenAvatar,
  generateBarrelIndex as codegenBarrelIndex,
  generateCatalog as codegenCatalog,
  generateIconIndex as codegenIconIndex
} from './codegen'
import {
  buildSvgMap,
  collectIconDirs,
  ensureViewBox,
  getComponentName,
  isImageBased,
  isWhiteFill,
  OUTPUT_DIR_MAP,
  parseLogoTypeArg,
  parseSvgPathBounds,
  readColorPrimary
} from './svg-utils'
import { createRemoveBackgroundPlugin } from './svgo-remove-background'

/**
 * Extract CSS fill values from <style> blocks for class-based styling.
 * Returns a map of className → fill color.
 */
function extractCssFills(svgCode: string): Map<string, string> {
  const map = new Map<string, string>()
  const styleMatch = svgCode.match(/<style[^>]*>([\s\S]*?)<\/style>/)
  if (!styleMatch) return map
  for (const rule of styleMatch[1].matchAll(/\.([a-zA-Z0-9_-]+)\s*\{[^}]*?\bfill\s*:\s*([^;}\s]+)/g)) {
    map.set(rule[1], rule[2])
  }
  return map
}

/**
 * Get the fill value of an SVG element from its attribute string,
 * checking both inline fill= and CSS class-based fills.
 */
function getElementFill(attrs: string, cssFills: Map<string, string>): string | null {
  const fillMatch = attrs.match(/\bfill="([^"]+)"/)
  if (fillMatch && fillMatch[1] !== 'none') return fillMatch[1]
  const classMatch = attrs.match(/\bclass="([^"]+)"/)
  if (classMatch) {
    const fill = cssFills.get(classMatch[1])
    if (fill && fill !== 'none') return fill
  }
  return null
}

/**
 * Parse a numeric attribute value from an element's attribute string.
 */
function parseAttrFloat(attrs: string, name: string): number {
  const match = attrs.match(new RegExp(`\\b${name}="([^"]+)"`))
  return match ? parseFloat(match[1]) : NaN
}

/**
 * Supplementary background detection: checks if the first visual element
 * covers most of the viewBox, regardless of fill color or luminance.
 *
 * Handles cases the svgo plugin misses:
 *   - Vectorized rects using C curves instead of H/V commands
 *   - Medium-luminance backgrounds (e.g. red, blue)
 *   - CSS class-based fills (e.g. z-ai)
 *   - Non-zero-origin rounded rects (e.g. youdao)
 */
function detectBackgroundByArea(svgCode: string): boolean {
  // Parse viewBox
  const vbMatch = svgCode.match(/viewBox\s*=\s*"([^"]+)"/)
  if (!vbMatch) return false
  const vbParts = vbMatch[1].split(/[\s,]+/).map(Number)
  if (vbParts.length !== 4 || !vbParts.every(isFinite)) return false
  const [vbX, vbY, vbW, vbH] = vbParts

  // Extract CSS fills for class-based styling
  const cssFills = extractCssFills(svgCode)

  // Strip non-visual sections
  const stripped = svgCode
    .replace(/<defs[\s\S]*?<\/defs>/gi, '')
    .replace(/<mask[\s\S]*?<\/mask>/gi, '')
    .replace(/<clipPath[\s\S]*?<\/clipPath>/gi, '')

  // Collect all <path> and <rect> elements
  const pathMatches = [...stripped.matchAll(/<path\b([^>]*)>/g)]
  const rectMatches = [...stripped.matchAll(/<rect\b([^>]*)>/g)]
  const totalVisual = pathMatches.length + rectMatches.length
  if (totalVisual < 2) return false

  // Determine which element comes first in document order
  const firstPathPos = pathMatches.length > 0 ? stripped.indexOf(pathMatches[0][0]) : Infinity
  const firstRectPos = rectMatches.length > 0 ? stripped.indexOf(rectMatches[0][0]) : Infinity

  let bounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null

  if (firstPathPos < firstRectPos && pathMatches.length > 0) {
    const attrs = pathMatches[0][1]
    const fill = getElementFill(attrs, cssFills)
    if (!fill) return false

    // Skip white/near-white fills — those are already handled by the svgo plugin (Rule 4)
    if (isWhiteFill(fill)) return false

    const dMatch = attrs.match(/\bd="([^"]+)"/)
    if (!dMatch) return false

    // Background shapes use a single closed subpath (1 M command).
    // Multiple M commands indicate scattered shapes (e.g. dots, letters).
    const mCount = (dMatch[1].match(/[Mm]/g) || []).length
    if (mCount > 1) return false

    bounds = parseSvgPathBounds(dMatch[1])
    if (!isFinite(bounds.minX)) return false

    // Apply translate transform if present
    const txMatch = attrs.match(/\btransform="[^"]*translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/)
    if (txMatch) {
      const dx = parseFloat(txMatch[1]) || 0
      const dy = parseFloat(txMatch[2]) || 0
      bounds.minX += dx
      bounds.maxX += dx
      bounds.minY += dy
      bounds.maxY += dy
    }
  } else if (rectMatches.length > 0) {
    const attrs = rectMatches[0][1]
    const fill = getElementFill(attrs, cssFills)
    if (!fill) return false

    if (isWhiteFill(fill)) return false

    const w = parseAttrFloat(attrs, 'width')
    const h = parseAttrFloat(attrs, 'height')
    if (!isFinite(w) || !isFinite(h)) return false
    const x = parseAttrFloat(attrs, 'x') || 0
    const y = parseAttrFloat(attrs, 'y') || 0
    bounds = { minX: x, minY: y, maxX: x + w, maxY: y + h }
  }

  if (!bounds) return false

  // Check if bounds cover the viewBox edges (within 15% tolerance)
  const margin = Math.max(vbW, vbH) * 0.15
  return (
    bounds.minX <= vbX + margin &&
    bounds.minY <= vbY + margin &&
    bounds.maxX >= vbX + vbW - margin &&
    bounds.maxY >= vbY + vbH - margin
  )
}

/**
 * Detect whether a source SVG has a background shape.
 *
 * Strategy 1: svgo removeBackground plugin in detectOnly mode (handles
 *   rects, rounded-rect paths, dark backgrounds, white backgrounds).
 * Strategy 2: Area-based heuristic fallback (handles vectorized rects,
 *   medium-luminance backgrounds, CSS-styled fills).
 */
function detectHasBackground(svgPath: string): boolean {
  const svgCode = fs.readFileSync(svgPath, 'utf-8')
  if (isImageBased(svgCode)) return false

  const processedSvg = ensureViewBox(svgCode)

  // Strategy 1: svgo plugin detection
  const bgPlugin = createRemoveBackgroundPlugin({ detectOnly: true })
  const svgoConfig: Config = {
    plugins: [bgPlugin.plugin]
  }
  optimize(processedSvg, svgoConfig)
  if (bgPlugin.wasRemoved()) return true

  // Strategy 2: Area-based fallback
  return detectBackgroundByArea(processedSvg)
}

/**
 * Generate avatar.tsx with full-bleed rendering (for SVGs with background).
 */
function generateFullBleedAvatar(baseDir: string, dirName: string): void {
  const colorName = getComponentName(baseDir, dirName)
  codegenAvatar({
    outPath: path.join(baseDir, dirName, 'avatar.tsx'),
    colorName,
    variant: 'full-bleed'
  })
}

/**
 * Generate avatar.tsx with padded rendering (for SVGs without background).
 */
function generatePaddedAvatar(baseDir: string, dirName: string): void {
  const colorName = getComponentName(baseDir, dirName)
  codegenAvatar({
    outPath: path.join(baseDir, dirName, 'avatar.tsx'),
    colorName,
    variant: 'padded'
  })
}

/**
 * Generate per-icon index.ts with compound export (Color + Mono + Avatar).
 */
function generateIconIndex(baseDir: string, dirName: string): void {
  const colorName = getComponentName(baseDir, dirName)
  const colorPrimary = readColorPrimary(baseDir, dirName)
  const hasMono = fs.existsSync(path.join(baseDir, dirName, 'mono.tsx'))

  codegenIconIndex({
    outPath: path.join(baseDir, dirName, 'index.ts'),
    colorName,
    hasMono,
    hasAvatar: true,
    colorPrimary
  })
}

/**
 * Generate the barrel index.ts that re-exports all compound icons.
 */
function generateBarrelIndex(baseDir: string, iconDirs: string[]): void {
  const entries = iconDirs.map((dirName) => ({
    dirName,
    colorName: getComponentName(baseDir, dirName)
  }))

  const headerLines = [
    'Auto-generated compound icon exports',
    'Each icon supports: <Icon /> (Color default), <Icon.Color />, <Icon.Mono />, <Icon.Avatar />, Icon.colorPrimary',
    'Do not edit manually',
    '',
    `Generated at: ${new Date().toISOString()}`,
    `Total icons: ${iconDirs.length}`
  ]

  codegenBarrelIndex({
    outPath: path.join(baseDir, 'index.ts'),
    entries,
    header: headerLines.join('\n')
  })
  console.log(`\nGenerated barrel index.ts with ${iconDirs.length} compound exports`)
}

// ──────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────

function main() {
  const iconType = parseLogoTypeArg()
  const baseDir = OUTPUT_DIR_MAP[iconType]
  const svgMap = buildSvgMap(iconType)

  console.log(`Generating avatars (type: ${iconType})...\n`)

  const iconDirs = collectIconDirs(baseDir)
  let fullBleedCount = 0
  let paddedCount = 0

  for (const dirName of iconDirs) {
    const colorName = getComponentName(baseDir, dirName)
    const avatarName = `${colorName}Avatar`

    const svgPath = svgMap.get(dirName)
    const hasBackground = svgPath && fs.existsSync(svgPath) ? detectHasBackground(svgPath) : false

    if (hasBackground) {
      generateFullBleedAvatar(baseDir, dirName)
      console.log(`  ${dirName}/ -> ${avatarName} (full-bleed)`)
      fullBleedCount++
    } else {
      generatePaddedAvatar(baseDir, dirName)
      console.log(`  ${dirName}/ -> ${avatarName} (padded)`)
      paddedCount++
    }

    generateIconIndex(baseDir, dirName)
  }

  generateBarrelIndex(baseDir, iconDirs)

  // Generate catalog.ts for runtime icon lookup
  const catalogName = iconType === 'models' ? 'MODEL_ICON_CATALOG' : 'PROVIDER_ICON_CATALOG'
  const catalogEntries = iconDirs.map((dirName) => ({
    dirName,
    colorName: getComponentName(baseDir, dirName)
  }))
  codegenCatalog({
    outPath: path.join(baseDir, 'catalog.ts'),
    entries: catalogEntries,
    catalogName
  })
  console.log(`Generated catalog.ts (${catalogName}) with ${catalogEntries.length} entries`)

  console.log(
    `\nDone! Generated ${fullBleedCount + paddedCount} avatar components (${fullBleedCount} full-bleed, ${paddedCount} padded)`
  )
}

main()
