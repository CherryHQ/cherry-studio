/**
 * Generate React components from SVG files using @svgr/core
 *
 * Supports incremental generation via SHA256 hash cache.
 * Use --force to skip cache and regenerate all files.
 *
 * Modes:
 *   --type=icons      icons/general/*.svg    → src/components/icons/general/{name}.tsx      (flat)
 *   --type=providers   icons/providers/*.svg  → src/components/icons/providers/{name}/color.tsx (per-provider dir)
 *   --type=models      icons/models/*.svg     → src/components/icons/models/{name}/color.tsx   (per-model dir)
 */
import { transform } from '@svgr/core'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'

import { createRemoveBackgroundPlugin } from './svgo-remove-background'

type IconType = 'icons' | 'providers' | 'models'

const DEFAULT_TYPE: IconType = 'icons'
const HASH_CACHE_FILE = path.join(__dirname, '../.icons-hash.json')

const SOURCE_DIR_MAP: Record<IconType, string> = {
  icons: path.join(__dirname, '../icons/general'),
  providers: path.join(__dirname, '../icons/providers'),
  models: path.join(__dirname, '../icons/models')
}

const OUTPUT_DIR_MAP: Record<IconType, string> = {
  icons: path.join(__dirname, '../src/components/icons/general'),
  providers: path.join(__dirname, '../src/components/icons/providers'),
  models: path.join(__dirname, '../src/components/icons/models')
}

type HashCache = Record<string, string>

async function loadHashCache(): Promise<HashCache> {
  try {
    const data = await fs.readFile(HASH_CACHE_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return {}
  }
}

async function saveHashCache(cache: HashCache): Promise<void> {
  await fs.writeFile(HASH_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8')
}

function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function parseTypeArg(): IconType {
  const arg = process.argv.find((item) => item.startsWith('--type='))
  if (!arg) return DEFAULT_TYPE

  const value = arg.split('=')[1]
  if (value === 'icons' || value === 'providers' || value === 'models') return value

  throw new Error(`Invalid --type value: ${value}. Use "icons", "providers", or "models".`)
}

async function ensureInputDir(type: IconType): Promise<string> {
  const inputDir = SOURCE_DIR_MAP[type]
  const stat = await fs.stat(inputDir).catch(() => null)
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Source directory not found for type=${type}. Expected: ${inputDir}`)
  }
  return inputDir
}

async function ensureOutputDir(type: IconType): Promise<string> {
  const outputDir = OUTPUT_DIR_MAP[type]
  await fs.mkdir(outputDir, { recursive: true })
  return outputDir
}

/**
 * Convert filename to PascalCase component name
 * Handle numeric prefix: 302ai -> Ai302
 */
function toPascalCase(filename: string): string {
  const name = filename.replace(/\.svg$/, '')

  if (/^\d/.test(name)) {
    const match = name.match(/^(\d+)(.*)$/)
    if (match) {
      const [, numbers, rest] = match
      const restCamel = rest.replace(/-([a-z])/g, (_, char) => char.toUpperCase())
      return restCamel.charAt(0).toUpperCase() + restCamel.slice(1) + numbers
    }
  }

  // Convert kebab-case to PascalCase: aws-bedrock -> AwsBedrock
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}

/**
 * Ensure SVG has a viewBox attribute.
 * Some traced/bitmap SVGs only have width/height but no viewBox.
 * Without viewBox, SVGR's icon:true (width/height="1em") clips all content.
 */
function ensureViewBox(svgCode: string): string {
  if (/viewBox\s*=\s*"[^"]*"/.test(svgCode)) {
    return svgCode
  }

  const widthMatch = svgCode.match(/<svg[^>]*\bwidth="(\d+(?:\.\d+)?)"/)
  const heightMatch = svgCode.match(/<svg[^>]*\bheight="(\d+(?:\.\d+)?)"/)

  if (widthMatch && heightMatch) {
    const w = widthMatch[1]
    const h = heightMatch[1]
    return svgCode.replace(/<svg\b/, `<svg viewBox="0 0 ${w} ${h}"`)
  }

  return svgCode
}

/**
 * Convert kebab-case to camelCase for directory/file naming
 */
function toCamelCase(filename: string): string {
  const name = filename.replace(/\.svg$/, '')
  const parts = name.split('-')

  if (parts.length === 1) {
    return parts[0]
  }

  return (
    parts[0] +
    parts
      .slice(1)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('')
  )
}

/**
 * Extract the most prominent fill color from SVG content.
 */
function extractColorPrimary(svgContent: string): string {
  const fills = [...svgContent.matchAll(/fill="([^"]+)"/g)]
  const colorCounts = new Map<string, number>()

  for (const [, color] of fills) {
    if (color === 'none' || color === 'currentColor' || color.startsWith('url(')) continue
    if (/^(?:white|#fff(?:fff)?|#FFFFFF)$/i.test(color)) continue
    colorCounts.set(color, (colorCounts.get(color) || 0) + 1)
  }

  if (colorCounts.size === 0) return '#000000'

  let maxColor = '#000000'
  let maxCount = 0
  for (const [color, count] of colorCounts) {
    if (count > maxCount) {
      maxColor = color
      maxCount = count
    }
  }

  // Normalize named colors
  if (/^black$/i.test(maxColor)) return '#000000'
  return maxColor
}

/**
 * Run SVGR transform on SVG content, return TSX code.
 * Accepts optional extra svgo plugins that run before preset-default.
 */
async function svgrTransform(svgCode: string, componentName: string, extraSvgoPlugins: any[] = []): Promise<string> {
  const processedSvg = ensureViewBox(svgCode)

  let jsCode = await transform(
    processedSvg,
    {
      plugins: ['@svgr/plugin-svgo', '@svgr/plugin-jsx', '@svgr/plugin-prettier'],
      icon: true,
      typescript: true,
      jsxRuntime: 'automatic',
      svgoConfig: {
        plugins: [
          ...extraSvgoPlugins,
          {
            name: 'preset-default',
            params: {
              overrides: {
                removeViewBox: false,
                convertPathData: false
              }
            }
          },
          {
            name: 'prefixIds',
            params: {
              prefix: componentName.toLowerCase()
            }
          }
        ]
      }
    },
    { componentName }
  )

  // Add named export
  jsCode = jsCode.replace(
    `export default ${componentName};`,
    `export { ${componentName} };\nexport default ${componentName};`
  )

  return jsCode
}

/**
 * Generate flat icon component (for --type=icons)
 */
async function generateFlatIcon(
  svgPath: string,
  outputDir: string,
  componentName: string,
  outputFilename: string
): Promise<void> {
  const svgCode = await fs.readFile(svgPath, 'utf-8')
  const jsCode = await svgrTransform(svgCode, componentName)
  await fs.writeFile(path.join(outputDir, outputFilename), jsCode, 'utf-8')
}

/**
 * Generate per-logo directory with color.tsx and meta.ts (for --type=logos).
 * Uses removeBackground svgo plugin to strip background shapes and capture
 * the background fill for colorPrimary.
 */
async function generateLogoDir(
  svgPath: string,
  outputDir: string,
  dirName: string,
  componentName: string
): Promise<void> {
  const logoDir = path.join(outputDir, dirName)
  await fs.mkdir(logoDir, { recursive: true })

  const svgCode = await fs.readFile(svgPath, 'utf-8')

  // Detect background fill for colorPrimary (detectOnly: don't modify the SVG)
  const bgPlugin = createRemoveBackgroundPlugin({ detectOnly: true })

  // Generate color.tsx — background is preserved, plugin only detects colorPrimary
  let jsCode = await svgrTransform(svgCode, componentName, [bgPlugin.plugin])
  jsCode = jsCode.replace(
    `import type { SVGProps } from "react";`,
    `import type { SVGProps } from "react";\nimport type { IconComponent } from '../../types'`
  )
  jsCode = jsCode.replace(`const ${componentName} =`, `const ${componentName}: IconComponent =`)
  await fs.writeFile(path.join(logoDir, 'color.tsx'), jsCode, 'utf-8')

  // Use background fill for colorPrimary; fall back to most prominent fill in source
  let colorPrimary = bgPlugin.getBackgroundFill() || extractColorPrimary(svgCode)
  if (/^black$/i.test(colorPrimary)) colorPrimary = '#000000'
  const metaContent = `import type { IconMeta } from '../../types'

export const meta: IconMeta = {
  id: '${dirName}',
  colorPrimary: '${colorPrimary}',
}
`
  await fs.writeFile(path.join(logoDir, 'meta.ts'), metaContent, 'utf-8')
}

/**
 * Generate flat index.ts (for --type=icons)
 */
async function generateFlatIndex(outputDir: string, components: Array<{ filename: string; componentName: string }>) {
  const exports = components
    .map(({ filename, componentName }) => {
      const basename = filename.replace('.tsx', '')
      return `export { ${componentName} } from './${basename}'`
    })
    .sort()
    .join('\n')

  const indexContent = `/**
 * Auto-generated icon exports
 * Do not edit manually
 *
 * Generated at: ${new Date().toISOString()}
 * Total icons: ${components.length}
 */

${exports}
`
  await fs.writeFile(path.join(outputDir, 'index.ts'), indexContent, 'utf-8')
}

/**
 * Main function
 */
async function main() {
  const type = parseTypeArg()
  const force = process.argv.includes('--force')

  console.log(`Starting icon generation (type: ${type})${force ? ' [FORCE]' : ''}...\n`)

  const inputDir = await ensureInputDir(type)
  const outputDir = await ensureOutputDir(type)

  const files = await fs.readdir(inputDir)
  const svgFiles = files.filter((f) => f.endsWith('.svg'))

  console.log(`Found ${svgFiles.length} SVG files in ${inputDir}\n`)

  const hashCache = force ? {} : await loadHashCache()
  const newHashCache: HashCache = { ...hashCache }
  const components: Array<{ dirName: string; componentName: string }> = []
  let skipped = 0

  for (const svgFile of svgFiles) {
    const svgPath = path.join(inputDir, svgFile)
    const componentName = toPascalCase(svgFile)
    const dirName = toCamelCase(svgFile)

    try {
      const svgContent = await fs.readFile(svgPath, 'utf-8')
      const cacheKey = `${type}:${svgFile}`
      const hash = computeHash(svgContent)

      if (type === 'providers' || type === 'models') {
        // Per-directory output (color.tsx + meta.ts)
        const colorFile = path.join(outputDir, dirName, 'color.tsx')
        const outputExists = await fs
          .stat(colorFile)
          .then(() => true)
          .catch(() => false)

        if (!force && hashCache[cacheKey] === hash && outputExists) {
          components.push({ dirName, componentName })
          skipped++
          continue
        }

        await generateLogoDir(svgPath, outputDir, dirName, componentName)
      } else {
        // Flat output
        const outputFilename = dirName + '.tsx'
        const outputPath = path.join(outputDir, outputFilename)
        const outputExists = await fs
          .stat(outputPath)
          .then(() => true)
          .catch(() => false)

        if (!force && hashCache[cacheKey] === hash && outputExists) {
          components.push({ dirName: outputFilename, componentName })
          skipped++
          continue
        }

        await generateFlatIcon(svgPath, outputDir, componentName, outputFilename)
      }

      components.push({ dirName: type !== 'icons' ? dirName : dirName + '.tsx', componentName })
      newHashCache[cacheKey] = hash
      console.log(`  ${svgFile} -> ${componentName}`)
    } catch (error) {
      console.error(`  Failed to process ${svgFile}:`, error)
    }
  }

  await saveHashCache(newHashCache)

  if (type === 'icons') {
    console.log('\nGenerating index.ts...')
    await generateFlatIndex(
      outputDir,
      components.map((c) => ({ filename: c.dirName, componentName: c.componentName }))
    )
  }
  // For providers/models, index.ts is generated by generate-mono-icons.ts after mono conversion

  const generated = components.length - skipped
  console.log(
    `\nGeneration complete! ${generated} generated, ${skipped} unchanged (cached), ${svgFiles.length - components.length} failed`
  )
}

main()
