/**
 * Shared code generators using ts-morph for AST-level TypeScript generation.
 *
 * Provides a single source of truth for all generated file shapes:
 *   - generateIconIndex  — per-icon index.ts (compound export)
 *   - generateAvatar     — per-icon avatar.tsx
 *   - generateMeta       — per-icon meta.ts
 *   - generateBarrelIndex — barrel index.ts (re-exports)
 */

import { execSync } from 'child_process'
import * as fs from 'fs'
import { IndentationText, NewLineKind, Project, QuoteKind, VariableDeclarationKind } from 'ts-morph'

const project = new Project({
  useInMemoryFileSystem: true,
  manipulationSettings: {
    quoteKind: QuoteKind.Single,
    useTrailingCommas: false,
    newLineKind: NewLineKind.LineFeed,
    indentationText: IndentationText.TwoSpaces
  }
})

/** Write file and format it with biome to match project conventions (no semicolons, single quotes, etc.) */
function writeAndFormat(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content)
  try {
    execSync(`npx biome format --write ${filePath}`, { stdio: 'ignore' })
  } catch {
    // biome format is best-effort; file is still written
  }
}

// ---------------------------------------------------------------------------
// generateIconIndex
// ---------------------------------------------------------------------------

export function generateIconIndex(opts: {
  outPath: string
  colorName: string
  hasMono: boolean
  hasAvatar: boolean
  colorPrimary: string
}): void {
  const { outPath, colorName, hasMono, hasAvatar, colorPrimary } = opts
  const monoName = `${colorName}Mono`
  const avatarName = `${colorName}Avatar`
  const monoRef = hasMono ? monoName : colorName

  const sf = project.createSourceFile('index.ts', '', { overwrite: true })

  sf.addImportDeclaration({
    moduleSpecifier: '../../types',
    namedImports: [{ name: 'CompoundIcon', isTypeOnly: true }]
  })

  if (hasAvatar) {
    sf.addImportDeclaration({
      moduleSpecifier: './avatar',
      namedImports: [avatarName]
    })
  }

  sf.addImportDeclaration({
    moduleSpecifier: './color',
    namedImports: [colorName]
  })

  if (hasMono) {
    sf.addImportDeclaration({
      moduleSpecifier: './mono',
      namedImports: [monoName]
    })
  }

  const assignParts = [`Color: ${colorName}`, `Mono: ${monoRef}`]
  if (hasAvatar) {
    assignParts.push(`Avatar: ${avatarName}`)
  }
  assignParts.push(`colorPrimary: '${colorPrimary}'`)

  sf.addVariableStatement({
    isExported: true,
    declarationKind: VariableDeclarationKind.Const,
    declarations: [
      {
        name: `${colorName}Icon`,
        type: 'CompoundIcon',
        initializer: `/*#__PURE__*/ Object.assign(${colorName}, { ${assignParts.join(', ')} })`
      }
    ]
  })

  sf.addExportAssignment({
    isExportEquals: false,
    expression: `${colorName}Icon`
  })

  writeAndFormat(outPath, sf.getFullText())
}

// ---------------------------------------------------------------------------
// generateAvatar
// ---------------------------------------------------------------------------

export function generateAvatar(opts: { outPath: string; colorName: string; variant: 'full-bleed' | 'padded' }): void {
  const { outPath, colorName, variant } = opts
  const avatarName = `${colorName}Avatar`

  const sf = project.createSourceFile('avatar.tsx', '', { overwrite: true })

  sf.addImportDeclaration({
    moduleSpecifier: '../../../../lib/utils',
    namedImports: ['cn']
  })

  sf.addImportDeclaration({
    moduleSpecifier: '../../../primitives/Avatar',
    namedImports: ['Avatar']
  })

  sf.addImportDeclaration({
    moduleSpecifier: '../../types',
    namedImports: [{ name: 'IconAvatarProps', isTypeOnly: true }]
  })

  sf.addImportDeclaration({
    moduleSpecifier: './color',
    namedImports: [colorName]
  })

  const iconSize = variant === 'full-bleed' ? 'size' : 'size * 0.75'
  const extraClasses = variant === 'padded' ? ' bg-background' : ''

  sf.addFunction({
    isExported: true,
    name: avatarName,
    parameters: [
      {
        name: `{ size = 32, shape = 'circle', className }`,
        type: `Omit<IconAvatarProps, 'icon'>`
      }
    ],
    statements: `return (
    <Avatar
      showFallback
      icon={<${colorName} style={{ width: ${iconSize}, height: ${iconSize} }} />}
      radius={shape === 'circle' ? 'full' : 'none'}
      className={cn(
        'overflow-hidden${extraClasses}',
        shape !== 'circle' && 'rounded-[20%]',
        className
      )}
      style={{ width: size, height: size }}
    />
  )`
  })

  writeAndFormat(outPath, sf.getFullText())
}

// ---------------------------------------------------------------------------
// generateMeta
// ---------------------------------------------------------------------------

export function generateMeta(opts: {
  outPath: string
  dirName: string
  colorPrimary: string
  colorScheme: 'mono' | 'color'
}): void {
  const { outPath, dirName, colorPrimary, colorScheme } = opts

  const sf = project.createSourceFile('meta.ts', '', { overwrite: true })

  sf.addImportDeclaration({
    moduleSpecifier: '../../types',
    namedImports: [{ name: 'IconMeta', isTypeOnly: true }]
  })

  sf.addVariableStatement({
    isExported: true,
    declarationKind: VariableDeclarationKind.Const,
    declarations: [
      {
        name: 'meta',
        type: 'IconMeta',
        initializer: `{
  id: '${dirName}',
  colorPrimary: '${colorPrimary}',
  colorScheme: '${colorScheme}',
}`
      }
    ]
  })

  writeAndFormat(outPath, sf.getFullText())
}

// ---------------------------------------------------------------------------
// generateBarrelIndex
// ---------------------------------------------------------------------------

export function generateBarrelIndex(opts: {
  outPath: string
  entries: Array<{ dirName: string; colorName: string }>
  header?: string
}): void {
  const { outPath, entries, header } = opts

  const sf = project.createSourceFile('index.ts', '', { overwrite: true })

  if (header) {
    sf.addStatements((writer) => {
      writer.writeLine(`/**`)
      for (const line of header.split('\n')) {
        writer.writeLine(` * ${line}`)
      }
      writer.writeLine(` */`)
    })
  }

  for (const { dirName, colorName } of entries) {
    sf.addExportDeclaration({
      namedExports: [{ name: `${colorName}Icon`, alias: colorName }],
      moduleSpecifier: `./${dirName}`
    })
  }

  writeAndFormat(outPath, sf.getFullText())
}

// ---------------------------------------------------------------------------
// generateCatalog
// ---------------------------------------------------------------------------

/**
 * Generate a catalog.ts that maps camelCase keys to CompoundIcon values.
 * Uses `as const satisfies` for type-safe key access while preserving
 * literal key types.
 *
 * Output:
 *   import type { CompoundIcon } from '../types'
 *   import { FooIcon } from './foo'
 *   ...
 *   export const PROVIDER_ICON_CATALOG = { foo: FooIcon, ... } as const satisfies Record<string, CompoundIcon>
 *   export type ProviderIconKey = keyof typeof PROVIDER_ICON_CATALOG
 */
export function generateCatalog(opts: {
  outPath: string
  entries: Array<{ dirName: string; colorName: string }>
  catalogName: string
}): void {
  const { outPath, entries, catalogName } = opts

  const sf = project.createSourceFile('catalog.ts', '', { overwrite: true })

  sf.addStatements((writer) => {
    writer.writeLine(`/**`)
    writer.writeLine(` * Auto-generated icon catalog for runtime lookup`)
    writer.writeLine(` * Do not edit manually — regenerated by the icon pipeline`)
    writer.writeLine(` *`)
    writer.writeLine(` * Generated at: ${new Date().toISOString()}`)
    writer.writeLine(` * Total icons: ${entries.length}`)
    writer.writeLine(` */`)
  })

  sf.addImportDeclaration({
    moduleSpecifier: '../types',
    namedImports: [{ name: 'CompoundIcon', isTypeOnly: true }]
  })

  for (const { dirName, colorName } of entries) {
    sf.addImportDeclaration({
      moduleSpecifier: `./${dirName}`,
      namedImports: [`${colorName}Icon`]
    })
  }

  // Derive the key type name from the catalog name, e.g.
  //   PROVIDER_ICON_CATALOG → ProviderIconKey
  //   MODEL_ICON_CATALOG    → ModelIconKey
  const keyTypeName =
    catalogName
      .replace(/_CATALOG$/, '')
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('')
      .replace(/Icon$/, 'Icon') + 'Key'

  // Use raw text to emit `as const satisfies` (ts-morph doesn't support this syntax natively)
  const objectBody = entries
    .map(({ dirName, colorName }) => {
      const key = /^\d/.test(dirName) ? `'${dirName}'` : dirName
      return `  ${key}: ${colorName}Icon`
    })
    .join(',\n')

  sf.addStatements((writer) => {
    writer.blankLine()
    writer.writeLine(
      `export const ${catalogName} = {\n${objectBody}\n} as const satisfies Record<string, CompoundIcon>`
    )
    writer.blankLine()
    writer.writeLine(`export type ${keyTypeName} = keyof typeof ${catalogName}`)
  })

  writeAndFormat(outPath, sf.getFullText())
}
