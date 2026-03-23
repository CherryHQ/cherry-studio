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

import { generateMeta } from './codegen'
import { colorToLuminance, ensureViewBox, isMonochromeSvg, toCamelCase } from './svg-utils'
import { createConvertToMonoPlugin } from './svgo-convert-to-mono'
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
 * Extract the most prominent fill color from SVG content.
 */
function extractColorPrimary(svgContent: string): string {
  const fills = [...svgContent.matchAll(/(?:fill|stroke)=["']([^"']+)["']/g)]
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
      prettier: true,
      prettierConfig: {
        singleQuote: true,
        semi: false,
        printWidth: 120,
        tabWidth: 2,
        useTabs: false,
        endOfLine: 'lf',
        bracketSameLine: false,
        bracketSpacing: true
      },
      jsxRuntime: 'automatic',
      svgoConfig: {
        plugins: [
          {
            name: 'removeForeignObject',
            fn: () => ({
              element: {
                enter: (node: any, parentNode: any) => {
                  if (node.name === 'foreignObject') {
                    parentNode.children = parentNode.children.filter((c: any) => c !== node)
                  }
                }
              }
            })
          },
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
    `export default ${componentName}`,
    `export { ${componentName} }\nexport default ${componentName}`
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
 *
 * For monochrome SVGs (single-color/achromatic), applies removeBackground +
 * convertToMono plugins so color.tsx uses currentColor for theme adaptation.
 */
async function generateLogoDir(
  svgPath: string,
  outputDir: string,
  dirName: string,
  componentName: string
): Promise<{ monochrome: boolean; darkDesigned: boolean }> {
  const logoDir = path.join(outputDir, dirName)
  await fs.mkdir(logoDir, { recursive: true })

  const svgCode = await fs.readFile(svgPath, 'utf-8')
  const { monochrome, darkDesigned } = isMonochromeSvg(svgCode)

  let jsCode: string
  let colorPrimary: string

  if (monochrome) {
    // Monochrome icon: remove background + convert to currentColor for theme adaptation
    const bgPlugin = createRemoveBackgroundPlugin()
    const monoPlugin = createConvertToMonoPlugin({
      get backgroundWasDark() {
        const fill = bgPlugin.getBackgroundFill()
        const lum = fill ? colorToLuminance(fill) : -1
        return (bgPlugin.wasRemoved() && lum >= 0 && lum < 0.5) || darkDesigned
      }
    })
    jsCode = await svgrTransform(svgCode, componentName, [bgPlugin.plugin, monoPlugin.plugin])

    // For colorPrimary: use background fill if available, else fall back to extractColorPrimary
    colorPrimary = bgPlugin.getBackgroundFill() || extractColorPrimary(svgCode)
  } else {
    // Colorful icon: detect-only background, preserve original colors
    const bgPlugin = createRemoveBackgroundPlugin({ detectOnly: true })
    jsCode = await svgrTransform(svgCode, componentName, [bgPlugin.plugin])
    colorPrimary = bgPlugin.getBackgroundFill() || extractColorPrimary(svgCode)

    // Replace near-black fills with currentColor for dark mode adaptation,
    // while preserving actual brand colors (e.g. Intel: black text + blue dot).
    // Skip when the icon has a preserved dark background — dark fills are integral
    // to the design and the icon provides its own contrast (e.g. Poe, Kimi).
    const bgFill = bgPlugin.getBackgroundFill()
    const bgLum = bgFill ? colorToLuminance(bgFill) : -1
    const hasDarkBackground = bgPlugin.wasRemoved() && bgLum >= 0 && bgLum < 0.15

    if (!hasDarkBackground) {
      jsCode = jsCode.replace(/fill="(#[0-9a-fA-F]{3,6})"/g, (match, hex) => {
        const lum = colorToLuminance(hex)
        if (lum >= 0 && lum < 0.15) {
          return 'fill="currentColor"'
        }
        return match
      })
      jsCode = jsCode.replace(/stroke="(#[0-9a-fA-F]{3,6})"/g, (match, hex) => {
        const lum = colorToLuminance(hex)
        if (lum >= 0 && lum < 0.15) {
          return 'stroke="currentColor"'
        }
        return match
      })
    }
  }

  jsCode = jsCode.replace(
    `import type { SVGProps } from 'react'`,
    `import type { SVGProps } from 'react'\n\nimport type { IconComponent } from '../../types'`
  )
  jsCode = jsCode.replace(`const ${componentName} =`, `const ${componentName}: IconComponent =`)
  await fs.writeFile(path.join(logoDir, 'color.tsx'), jsCode, 'utf-8')

  if (/^black$/i.test(colorPrimary)) colorPrimary = '#000000'
  const colorScheme = monochrome ? 'mono' : 'color'
  generateMeta({
    outPath: path.join(logoDir, 'meta.ts'),
    dirName,
    colorPrimary,
    colorScheme
  })

  return { monochrome, darkDesigned }
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

        const result = await generateLogoDir(svgPath, outputDir, dirName, componentName)
        components.push({ dirName, componentName })
        newHashCache[cacheKey] = hash

        const tags: string[] = []
        if (result.monochrome) tags.push('monochrome')
        if (result.darkDesigned) tags.push('dark-designed')
        const suffix = tags.length > 0 ? ` [${tags.join(', ')}]` : ''
        console.log(`  ${svgFile} -> ${componentName}${suffix}`)
        continue
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
