/**
 * Generate React components from SVG files using @svgr/core
 *
 * Supports incremental generation via SHA256 hash cache.
 * Use --force to skip cache and regenerate all files.
 *
 * Modes:
 *   --type=icons      icons/general/*.svg                     → src/components/icons/general/{name}.tsx      (flat)
 *   --type=providers  icons/providers/{light,dark}/*.svg      → src/components/icons/providers/{name}/{light,dark}.tsx
 *   --type=models     icons/models/{light,dark}/*.svg         → src/components/icons/models/{name}/{light,dark}.tsx
 */
import { transform } from '@svgr/core'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'

import { generateMeta } from './codegen'
import { buildLightDarkSvgMap, ensureViewBox, type LightDarkSvgPair, tightenSvgViewBox, toCamelCase } from './svg-utils'

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
 */
async function svgrTransform(svgCode: string, componentName: string): Promise<string> {
  const processedSvg = tightenSvgViewBox(ensureViewBox(svgCode))

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

  // Add IconComponent type annotation
  jsCode = jsCode.replace(
    `import type { SVGProps } from 'react'`,
    `import type { SVGProps } from 'react'\n\nimport type { IconComponent } from '../../types'`
  )
  jsCode = jsCode.replace(`const ${componentName} =`, `const ${componentName}: IconComponent =`)

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
 * Generate per-logo directory with light.tsx + optional dark.tsx + meta.ts.
 *
 * When the logo has no dedicated dark variant (pair.dark === null), no dark.tsx
 * is emitted. The public CompoundIcon API remains uniform through the component
 * `variant` prop; missing dark assets fall back to the light SVG internally.
 */
async function generateLogoDirDual(
  pair: LightDarkSvgPair,
  outputDir: string,
  dirName: string,
  componentName: string
): Promise<void> {
  const logoDir = path.join(outputDir, dirName)
  await fs.mkdir(logoDir, { recursive: true })

  const lightSvg = await fs.readFile(pair.light, 'utf-8')
  const lightTsx = await svgrTransform(lightSvg, `${componentName}Light`)
  await fs.writeFile(path.join(logoDir, 'light.tsx'), lightTsx, 'utf-8')

  if (pair.dark) {
    const darkSvg = await fs.readFile(pair.dark, 'utf-8')
    const darkTsx = await svgrTransform(darkSvg, `${componentName}Dark`)
    await fs.writeFile(path.join(logoDir, 'dark.tsx'), darkTsx, 'utf-8')
  } else {
    await fs.rm(path.join(logoDir, 'dark.tsx'), { force: true })
  }

  let colorPrimary = extractColorPrimary(lightSvg)
  if (/^black$/i.test(colorPrimary)) colorPrimary = '#000000'

  generateMeta({
    outPath: path.join(logoDir, 'meta.ts'),
    dirName,
    colorPrimary,
    colorScheme: 'color'
  })
}

async function removeStaleLogoDirs(outputDir: string, activeDirNames: Set<string>): Promise<number> {
  const entries = await fs.readdir(outputDir, { withFileTypes: true }).catch(() => [])
  let removed = 0

  for (const entry of entries) {
    if (!entry.isDirectory() || activeDirNames.has(entry.name)) continue

    const logoDir = path.join(outputDir, entry.name)
    const hasGeneratedIcon = await fs
      .stat(path.join(logoDir, 'light.tsx'))
      .then(() => true)
      .catch(() => false)

    if (!hasGeneratedIcon) continue
    await fs.rm(logoDir, { recursive: true, force: true })
    removed++
  }

  return removed
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

  const outputDir = await ensureOutputDir(type)

  if (type === 'providers' || type === 'models') {
    const svgMap = buildLightDarkSvgMap(type)
    console.log(`Found ${svgMap.size} light/dark SVG pairs in ${SOURCE_DIR_MAP[type]}\n`)
    const removedStale = await removeStaleLogoDirs(outputDir, new Set(svgMap.keys()))
    if (removedStale > 0)
      console.log(`Removed ${removedStale} stale generated icon director${removedStale === 1 ? 'y' : 'ies'}\n`)

    const hashCache = force ? {} : await loadHashCache()
    const newHashCache: HashCache = { ...hashCache }
    let generated = 0
    let skipped = 0

    for (const [dirName, pair] of svgMap) {
      // dirName is camelCase; we need the original file basename for componentName
      const baseFile = path.basename(pair.light)
      const componentName = toPascalCase(baseFile)

      try {
        const lightContent = await fs.readFile(pair.light, 'utf-8')
        const darkContent = pair.dark ? await fs.readFile(pair.dark, 'utf-8') : '<no-dark>'
        const hash = computeHash(`light:${lightContent}\ndark:${darkContent}`)
        const cacheKey = `${type}:${baseFile}`

        const lightFile = path.join(outputDir, dirName, 'light.tsx')
        const darkFile = path.join(outputDir, dirName, 'dark.tsx')
        const lightExists = await fs
          .stat(lightFile)
          .then(() => true)
          .catch(() => false)
        const darkExists = await fs
          .stat(darkFile)
          .then(() => true)
          .catch(() => false)
        const outputExists = lightExists && (pair.dark ? darkExists : !darkExists)

        if (!force && hashCache[cacheKey] === hash && outputExists) {
          skipped++
          continue
        }

        await generateLogoDirDual(pair, outputDir, dirName, componentName)
        newHashCache[cacheKey] = hash
        generated++
        console.log(`  ${baseFile} -> ${componentName}{Light${pair.dark ? ',Dark' : ''}}`)
      } catch (error) {
        console.error(`  Failed to process ${dirName}:`, error)
      }
    }

    await saveHashCache(newHashCache)
    console.log(`\nGeneration complete! ${generated} generated, ${skipped} unchanged (cached)`)
    return
  }

  // type === 'icons' — flat mode
  const inputDir = SOURCE_DIR_MAP[type]
  const inputStat = await fs.stat(inputDir).catch(() => null)
  if (!inputStat || !inputStat.isDirectory()) {
    throw new Error(`Source directory not found for type=${type}. Expected: ${inputDir}`)
  }

  const files = await fs.readdir(inputDir)
  const svgFiles = files.filter((f) => f.endsWith('.svg'))
  console.log(`Found ${svgFiles.length} SVG files in ${inputDir}\n`)

  const hashCache = force ? {} : await loadHashCache()
  const newHashCache: HashCache = { ...hashCache }
  const components: Array<{ filename: string; componentName: string }> = []
  let skipped = 0

  for (const svgFile of svgFiles) {
    const svgPath = path.join(inputDir, svgFile)
    const componentName = toPascalCase(svgFile)
    const baseName = toCamelCase(svgFile)
    const outputFilename = baseName + '.tsx'

    try {
      const svgContent = await fs.readFile(svgPath, 'utf-8')
      const cacheKey = `${type}:${svgFile}`
      const hash = computeHash(svgContent)
      const outputPath = path.join(outputDir, outputFilename)
      const outputExists = await fs
        .stat(outputPath)
        .then(() => true)
        .catch(() => false)

      if (!force && hashCache[cacheKey] === hash && outputExists) {
        components.push({ filename: outputFilename, componentName })
        skipped++
        continue
      }

      await generateFlatIcon(svgPath, outputDir, componentName, outputFilename)
      components.push({ filename: outputFilename, componentName })
      newHashCache[cacheKey] = hash
      console.log(`  ${svgFile} -> ${componentName}`)
    } catch (error) {
      console.error(`  Failed to process ${svgFile}:`, error)
    }
  }

  await saveHashCache(newHashCache)

  console.log('\nGenerating index.ts...')
  await generateFlatIndex(outputDir, components)

  const generated = components.length - skipped
  console.log(
    `\nGeneration complete! ${generated} generated, ${skipped} unchanged (cached), ${svgFiles.length - components.length} failed`
  )
}

void main()
