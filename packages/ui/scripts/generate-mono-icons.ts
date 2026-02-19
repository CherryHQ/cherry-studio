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

import { generateBarrelIndex as codegenBarrelIndex, generateIconIndex as codegenIconIndex } from './codegen'
import {
  buildSvgMap,
  collectIconDirs,
  colorToLuminance,
  ensureViewBox,
  getComponentName,
  isImageBased,
  OUTPUT_DIR_MAP,
  parseLogoTypeArg,
  readColorPrimary
} from './svg-utils'
import { createConvertToMonoPlugin } from './svgo-convert-to-mono'
import { createRemoveBackgroundPlugin } from './svgo-remove-background'

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
      return bgPlugin.wasRemoved() && lum >= 0 && lum < 0.5
    }
  })

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
                enter: (node, parentNode) => {
                  if (node.name === 'foreignObject') {
                    parentNode.children = parentNode.children.filter((c) => c !== node)
                  }
                }
              }
            })
          },
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
    `import type { SVGProps } from 'react'`,
    `import type { SVGProps } from 'react'\n\nimport type { IconComponent } from '../../types'`
  )
  jsCode = jsCode.replace(`const ${monoName} =`, `const ${monoName}: IconComponent =`)
  jsCode = jsCode.replace(`export default ${monoName}`, `export { ${monoName} }\nexport default ${monoName}`)

  return jsCode
}

/**
 * Call the shared generateIconIndex from codegen.
 * Detects Avatar presence and reads colorPrimary from meta.ts.
 */
function generateIconIndex(baseDir: string, dirName: string, hasMono: boolean): void {
  const colorName = getComponentName(baseDir, dirName)
  const colorPrimary = readColorPrimary(baseDir, dirName)
  const hasAvatar = fs.existsSync(path.join(baseDir, dirName, 'avatar.tsx'))

  codegenIconIndex({
    outPath: path.join(baseDir, dirName, 'index.ts'),
    colorName,
    hasMono,
    hasAvatar,
    colorPrimary
  })
}

/**
 * Generate the barrel index.ts via shared codegen.
 */
function generateBarrelIndex(baseDir: string, iconDirs: string[], skippedDirs: Set<string>): void {
  const entries = iconDirs.map((dirName) => ({
    dirName,
    colorName: getComponentName(baseDir, dirName)
  }))

  const headerLines = [
    'Auto-generated compound icon exports',
    'Each icon supports: <Icon /> (Color default), <Icon.Color />, <Icon.Mono />, Icon.colorPrimary',
    'Do not edit manually',
    '',
    `Generated at: ${new Date().toISOString()}`,
    `Total icons: ${iconDirs.length}`
  ]
  if (skippedDirs.size > 0) {
    headerLines.push(`Image-based icons (Mono = Color fallback): ${[...skippedDirs].join(', ')}`)
  }

  codegenBarrelIndex({
    outPath: path.join(baseDir, 'index.ts'),
    entries,
    header: headerLines.join('\n')
  })
  console.log(
    `\nGenerated index.ts with ${iconDirs.length} compound exports (${skippedDirs.size} image-based fallbacks)`
  )
}

// ──────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────

async function main() {
  const monoType = parseLogoTypeArg()
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
