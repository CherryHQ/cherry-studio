/**
 * Convert raster images (PNG/JPG) to SVG using @neplex/vectorizer
 *
 * Features:
 *   - Normalizes output with proper viewBox (matching icon system)
 *   - Auto-deletes original raster file after successful conversion
 *   - Outputs kebab-case SVG
 *
 * Usage:
 *   tsx scripts/vectorize-logo.ts path/to/logo.png
 *   tsx scripts/vectorize-logo.ts path/to/logo.png --preset=photo
 *   tsx scripts/vectorize-logo.ts path/to/*.png
 *   tsx scripts/vectorize-logo.ts --dir=providers        # batch: all PNG/JPG in icons/providers/
 *   tsx scripts/vectorize-logo.ts --dir=models --size=48  # batch with custom size
 */
import { vectorize } from '@neplex/vectorizer'
import fs from 'fs/promises'
import path from 'path'

const DEFAULT_ICON_SIZE = 32

// Enum values from @neplex/vectorizer (numeric to avoid isolatedModules const enum issue)
const COLOR_MODE_COLOR = 0
const HIERARCHICAL_STACKED = 0
const PATH_SIMPLIFY_SPLINE = 2
const PRESET_BW = 0
const PRESET_POSTER = 1
const PRESET_PHOTO = 2

type PresetName = 'poster' | 'photo' | 'bw' | 'custom'
type SourceDir = 'providers' | 'models'

const RASTER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg'])

interface CliArgs {
  inputs: string[]
  outputDir: string
  preset: PresetName
  size: number
  dir?: SourceDir
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const inputs: string[] = []
  let outputDir = ''
  let preset: PresetName = 'custom'
  let size = DEFAULT_ICON_SIZE
  let dir: SourceDir | undefined

  for (const arg of args) {
    if (arg.startsWith('--output=')) {
      outputDir = arg.split('=')[1]
    } else if (arg.startsWith('--preset=')) {
      const value = arg.split('=')[1]
      if (['poster', 'photo', 'bw'].includes(value)) {
        preset = value as PresetName
      } else {
        throw new Error(`Invalid preset: ${value}. Use "poster", "photo", or "bw".`)
      }
    } else if (arg.startsWith('--dir=')) {
      const value = arg.split('=')[1]
      if (value === 'providers' || value === 'models') {
        dir = value
      } else {
        throw new Error(`Invalid --dir value: ${value}. Use "providers" or "models".`)
      }
    } else if (arg.startsWith('--size=')) {
      const value = parseInt(arg.split('=')[1], 10)
      if (isNaN(value) || value <= 0) {
        throw new Error(`Invalid --size value. Must be a positive integer.`)
      }
      size = value
    } else if (!arg.startsWith('--')) {
      inputs.push(arg)
    }
  }

  // When --dir is provided, resolve outputDir and scan for raster files
  if (dir) {
    if (!outputDir) {
      outputDir = path.join(__dirname, '../icons', dir)
    }
  } else {
    if (!outputDir) {
      outputDir = path.join(__dirname, '../icons/providers')
    }
    if (inputs.length === 0) {
      console.error(
        'Usage: tsx scripts/vectorize-logo.ts <input.png> [--output=<dir>] [--preset=poster|photo|bw]\n' +
          '       tsx scripts/vectorize-logo.ts --dir=providers|models [--size=32] [--preset=...]'
      )
      process.exit(1)
    }
  }

  return { inputs, outputDir, preset, size, dir }
}

function getPresetConfig(preset: PresetName) {
  if (preset === 'poster') return PRESET_POSTER
  if (preset === 'photo') return PRESET_PHOTO
  if (preset === 'bw') return PRESET_BW

  // Custom config tuned for logo/icon quality
  return {
    colorMode: COLOR_MODE_COLOR,
    hierarchical: HIERARCHICAL_STACKED,
    filterSpeckle: 4,
    colorPrecision: 8,
    layerDifference: 6,
    mode: PATH_SIMPLIFY_SPLINE,
    cornerThreshold: 60,
    lengthThreshold: 4.0,
    maxIterations: 2,
    spliceThreshold: 45,
    pathPrecision: 2
  }
}

/**
 * Normalize vectorizer SVG output:
 *   - Add viewBox="0 0 {origW} {origH}"
 *   - Set width/height to target size
 *   - Remove XML declaration and generator comment
 */
function normalizeSvg(svg: string, size: number): string {
  let result = svg

  // Remove XML declaration and generator comment
  result = result.replace(/<\?xml[^?]*\?>\s*/g, '')
  result = result.replace(/<!--[^>]*-->\s*/g, '')

  // Parse original width/height
  const wMatch = result.match(/<svg[^>]*\bwidth="(\d+(?:\.\d+)?)"/)
  const hMatch = result.match(/<svg[^>]*\bheight="(\d+(?:\.\d+)?)"/)
  const origW = wMatch ? wMatch[1] : String(size)
  const origH = hMatch ? hMatch[1] : String(size)

  // Add viewBox if missing
  if (!/viewBox\s*=/.test(result)) {
    result = result.replace(/<svg\b/, `<svg viewBox="0 0 ${origW} ${origH}"`)
  }

  // Set width/height to icon size
  result = result.replace(/(<svg[^>]*)\bwidth="[^"]*"/, `$1width="${size}"`)
  result = result.replace(/(<svg[^>]*)\bheight="[^"]*"/, `$1height="${size}"`)

  // Add fill="none" if not present (matches other SVG sources)
  if (!/<svg[^>]*\bfill=/.test(result)) {
    result = result.replace(/<svg\b/, '<svg fill="none"')
  }

  return result.trim() + '\n'
}

function toKebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Scan a directory for raster image files (PNG/JPG/JPEG).
 */
async function scanRasterFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir)
    return entries
      .filter((f) => RASTER_EXTENSIONS.has(path.extname(f).toLowerCase()))
      .map((f) => path.join(dir, f))
      .sort()
  } catch {
    return []
  }
}

async function main() {
  const { inputs, outputDir, preset, size, dir } = parseArgs()
  const config = getPresetConfig(preset)

  // Resolve final input list
  let filesToProcess: string[]
  if (dir) {
    filesToProcess = await scanRasterFiles(outputDir)
    if (filesToProcess.length === 0) {
      console.log(`No PNG/JPG files found in icons/${dir}/. Nothing to vectorize.`)
      return
    }
  } else {
    filesToProcess = inputs
  }

  await fs.mkdir(outputDir, { recursive: true })

  console.log(`Vectorizing ${filesToProcess.length} file(s) (preset: ${preset}, size: ${size})...\n`)

  let succeeded = 0
  let failed = 0

  for (const inputPath of filesToProcess) {
    const baseName = path.basename(inputPath, path.extname(inputPath))
    const kebabName = toKebabCase(baseName)
    const outputPath = path.join(outputDir, `${kebabName}.svg`)

    try {
      const buffer = await fs.readFile(inputPath)
      const rawSvg = await vectorize(buffer, config)
      const svg = normalizeSvg(rawSvg, size)

      await fs.writeFile(outputPath, svg, 'utf-8')

      // Auto-delete source raster file
      await fs.unlink(inputPath)

      const inputSize = buffer.length
      const outputSize = Buffer.byteLength(svg)
      console.log(
        `  ${path.basename(inputPath)} -> ${kebabName}.svg` +
          ` (${(inputSize / 1024).toFixed(1)}KB -> ${(outputSize / 1024).toFixed(1)}KB)` +
          ` [source deleted]`
      )
      succeeded++
    } catch (error) {
      console.error(`  Failed: ${path.basename(inputPath)}: ${error}`)
      failed++
    }
  }

  console.log(`\nDone! ${succeeded} converted, ${failed} failed.`)
  if (succeeded > 0) {
    const label = dir || 'providers'
    console.log(`Output: ${outputDir}`)
    console.log(`\nNext steps:`)
    console.log(`  pnpm ${label}:validate        # check SVG quality`)
    console.log(`  pnpm ${label}:generate         # generate React components`)
    console.log(`  pnpm ${label}:generate:mono    # generate mono variants`)
    console.log(`\n  Or run the full pipeline:`)
    console.log(`  pnpm ${label}:pipeline`)
  }
}

main()
