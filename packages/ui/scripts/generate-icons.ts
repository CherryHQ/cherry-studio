/**
 * Generate React components from SVG files using @svgr/core
 * Simple approach: use SVGR defaults + component name handling
 */
import { transform } from '@svgr/core'
import fs from 'fs/promises'
import path from 'path'

type IconType = 'icons' | 'logos'

const DEFAULT_TYPE: IconType = 'icons'

const SOURCE_DIR_MAP: Record<IconType, string> = {
  icons: path.join(__dirname, '../icons/general'),
  logos: path.join(__dirname, '../icons/logos')
}

const OUTPUT_DIR_MAP: Record<IconType, string> = {
  icons: path.join(__dirname, '../src/components/icons/general'),
  logos: path.join(__dirname, '../src/components/icons/logos')
}

function parseTypeArg(): IconType {
  const arg = process.argv.find((item) => item.startsWith('--type='))
  if (!arg) return DEFAULT_TYPE

  const value = arg.split('=')[1]
  if (value === 'icons' || value === 'logos') return value

  throw new Error(`Invalid --type value: ${value}. Use "icons" or "logos".`)
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
 * Convert kebab-case to camelCase for filename
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
 * Generate a single icon component
 */
async function generateIcon(
  type: IconType,
  inputDir: string,
  outputDir: string,
  svgFile: string
): Promise<{ filename: string; componentName: string }> {
  const svgPath = path.join(inputDir, svgFile)
  const svgCode = await fs.readFile(svgPath, 'utf-8')

  const componentName = toPascalCase(svgFile)
  const outputFilename = toCamelCase(svgFile) + '.tsx'
  const outputPath = path.join(outputDir, outputFilename)

  // Use SVGR with simple config
  let jsCode = await transform(
    svgCode,
    {
      plugins: ['@svgr/plugin-svgo', '@svgr/plugin-jsx', '@svgr/plugin-prettier'],
      icon: true,
      typescript: true,
      jsxRuntime: 'automatic',
      svgoConfig: {
        plugins: [
          // {
          //   name: 'preset-default',
          //   params: {
          //     overrides: {
          //       removeViewBox: false,
          //       // Important: Keep IDs but make them unique per component
          //       cleanupIds: false
          //     }
          //   }
          // },
          {
            // Add unique prefix to all IDs based on component name
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

  await fs.writeFile(outputPath, jsCode, 'utf-8')

  return { filename: outputFilename, componentName }
}

/**
 * Generate index.ts file
 */
async function generateIndex(outputDir: string, components: Array<{ filename: string; componentName: string }>) {
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

  console.log(`🔧 Starting icon generation (type: ${type})...\n`)

  const inputDir = await ensureInputDir(type)
  const outputDir = await ensureOutputDir(type)

  const files = await fs.readdir(inputDir)
  const svgFiles = files.filter((f) => f.endsWith('.svg'))

  console.log(`📁 Found ${svgFiles.length} SVG files in ${inputDir}\n`)

  const components: Array<{ filename: string; componentName: string }> = []

  for (const svgFile of svgFiles) {
    try {
      const result = await generateIcon(type, inputDir, outputDir, svgFile)
      components.push(result)
      console.log(`✅ ${svgFile} -> ${result.filename} (${result.componentName})`)
    } catch (error) {
      console.error(`❌ Failed to process ${svgFile}:`, error)
    }
  }

  console.log('\n📝 Generating index.ts...')
  await generateIndex(outputDir, components)

  console.log(`\n✨ Generation complete! Successfully processed ${components.length}/${svgFiles.length} files`)
}

main()
