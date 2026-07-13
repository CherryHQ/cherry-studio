/**
 * Shared code generators using ts-morph for AST-level TypeScript generation.
 *
 * Provides a single source of truth for all generated file shapes:
 *   - generateIconIndex  — per-icon index.ts (compound export)
 *   - generateAvatar     — per-icon avatar.tsx
 *   - generateMeta       — per-icon meta.ts
 *   - generateBarrelIndex — barrel index.ts (re-exports)
 *   - generateMetaCatalog — meta-catalog.ts (sync key → IconMeta lookup, zero component deps)
 *   - generateCatalog    — catalog.ts (key → CompoundIcon lookup, loaded via dynamic import only)
 */

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

// ---------------------------------------------------------------------------
// generateIconIndex
// ---------------------------------------------------------------------------

export function generateIconIndex(opts: {
  outPath: string
  colorName: string
  hasAvatar: boolean
  hasDark: boolean
  usesCurrentColor?: boolean
  colorPrimary: string
}): void {
  const { outPath, colorName, hasAvatar, hasDark, usesCurrentColor = false, colorPrimary } = opts
  const lightName = `${colorName}Light`
  const darkName = `${colorName}Dark`
  const avatarName = `${colorName}Avatar`

  const avatarImport = hasAvatar ? `import { ${avatarName} } from './avatar'\n` : ''
  const avatarField = hasAvatar ? `  Avatar: ${avatarName},\n` : ''
  const darkImport = hasDark ? `import { ${darkName} } from './dark'\n` : ''
  const lightClassName = usesCurrentColor ? `cn('text-foreground', className)` : 'className'
  const darkClassName = usesCurrentColor ? `cn('text-foreground', className)` : 'className'
  const autoLightClassName = usesCurrentColor
    ? `cn('text-foreground dark:hidden', className)`
    : `cn('dark:hidden', className)`
  const autoDarkClassName = usesCurrentColor
    ? `cn('text-foreground hidden dark:block', className)`
    : `cn('hidden dark:block', className)`
  const autoRender = hasDark
    ? `return (
    <>
      <${lightName} className={${autoLightClassName}} {...props} />
      <${darkName} className={${autoDarkClassName}} {...props} />
    </>
  )`
    : `return <${lightName} {...props} className={${lightClassName}} />`
  const darkVariantRender = hasDark
    ? `  if (variant === 'dark') return <${darkName} {...props} className={${darkClassName}} />\n`
    : ''
  const cnImport = hasDark || usesCurrentColor ? `import { cn } from '../../../../lib/utils'\n` : ''

  const content = `${cnImport}import type { CompoundIcon, CompoundIconProps } from '../../types'
${avatarImport}${darkImport}
import { ${lightName} } from './light'

const ${colorName} = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <${lightName} {...props} className={${lightClassName}} />
${darkVariantRender}  ${autoRender}
}

export const ${colorName}Icon: CompoundIcon = /*#__PURE__*/ Object.assign(${colorName}, {
${avatarField}  colorPrimary: '${colorPrimary}'
})

export default ${colorName}Icon
`
  fs.writeFileSync(outPath, content)
}

// ---------------------------------------------------------------------------
// generateAvatar
// ---------------------------------------------------------------------------

export function generateAvatar(opts: {
  outPath: string
  colorName: string
  variant: 'full-bleed' | 'padded'
  hasDark: boolean
}): void {
  const { outPath, colorName, variant, hasDark } = opts
  const avatarName = `${colorName}Avatar`

  const sf = project.createSourceFile('avatar.tsx', '', { overwrite: true })

  sf.addImportDeclaration({
    moduleSpecifier: '@cherrystudio/ui/lib/utils',
    namedImports: ['cn']
  })

  sf.addImportDeclaration({
    moduleSpecifier: '@cherrystudio/ui/components/primitives/avatar',
    namedImports: ['Avatar', 'AvatarFallback']
  })

  sf.addImportDeclaration({
    moduleSpecifier: '../../types',
    namedImports: [{ name: 'IconAvatarProps', isTypeOnly: true }]
  })

  if (hasDark) {
    sf.addImportDeclaration({
      moduleSpecifier: './dark',
      namedImports: [`${colorName}Dark`]
    })
  }

  sf.addImportDeclaration({
    moduleSpecifier: './light',
    namedImports: [`${colorName}Light`]
  })

  const iconSize = variant === 'full-bleed' ? 'size * 0.82' : 'size * 0.7'
  const fallbackClasses = ['text-foreground', variant === 'padded' ? 'bg-background' : ''].filter(Boolean).join(' ')
  const iconRender = hasDark
    ? `<${colorName}Light
          className="dark:hidden"
          style={{ width: ${iconSize}, height: ${iconSize} }}
        />
        <${colorName}Dark
          className="hidden dark:block"
          style={{ width: ${iconSize}, height: ${iconSize} }}
        />`
    : `<${colorName}Light style={{ width: ${iconSize}, height: ${iconSize} }} />`

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
      className={cn(
        'overflow-hidden',
        shape === 'circle' ? 'rounded-full' : 'rounded-[20%]',
        className
      )}
      style={{ width: size, height: size }}
    >
      <AvatarFallback${fallbackClasses ? ` className="${fallbackClasses}"` : ''}>
        ${iconRender}
      </AvatarFallback>
    </Avatar>
  )`
  })

  fs.writeFileSync(outPath, sf.getFullText())
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

  fs.writeFileSync(outPath, sf.getFullText())
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

  fs.writeFileSync(outPath, sf.getFullText())
}

// ---------------------------------------------------------------------------
// generateMetaCatalog
// ---------------------------------------------------------------------------

/**
 * Generate a meta-catalog.ts that maps catalog keys to IconMeta values.
 * Zero component dependencies — safe to import from first-paint code.
 * The catalog key type is derived here so catalog.ts can be forced (via
 * `satisfies Record<Key, CompoundIcon>`) to stay key-identical.
 *
 * Output:
 *   import { type IconMeta } from '../types'
 *   import { meta as fooMeta } from './foo/meta'
 *   ...
 *   export const PROVIDER_ICON_META_CATALOG = { foo: fooMeta, ... } as const satisfies Record<string, IconMeta>
 *   export type ProviderIconKey = keyof typeof PROVIDER_ICON_META_CATALOG
 */
export function generateMetaCatalog(opts: {
  outPath: string
  entries: Array<{ dirName: string; colorName: string }>
  catalogName: string
  keyTypeName: string
}): void {
  const { outPath, entries, catalogName, keyTypeName } = opts

  const sf = project.createSourceFile('meta-catalog.ts', '', { overwrite: true })

  sf.addStatements((writer) => {
    writer.writeLine(`/**`)
    writer.writeLine(` * Auto-generated icon meta catalog for synchronous runtime lookup`)
    writer.writeLine(` * Do not edit manually — regenerated by the icon pipeline`)
    writer.writeLine(` *`)
    writer.writeLine(` * Generated at: ${new Date().toISOString()}`)
    writer.writeLine(` * Total icons: ${entries.length}`)
    writer.writeLine(` */`)
  })

  sf.addImportDeclaration({
    moduleSpecifier: '../types',
    namedImports: [{ name: 'IconMeta', isTypeOnly: true }]
  })

  const metaAlias = (colorName: string) => `${colorName.charAt(0).toLowerCase()}${colorName.slice(1)}Meta`

  for (const { dirName, colorName } of entries) {
    sf.addImportDeclaration({
      moduleSpecifier: `./${dirName}/meta`,
      namedImports: [{ name: 'meta', alias: metaAlias(colorName) }]
    })
  }

  const objectBody = entries
    .map(({ dirName, colorName }) => {
      const key = /^\d/.test(dirName) || dirName.includes('-') ? `'${dirName}'` : dirName
      return `  ${key}: ${metaAlias(colorName)}`
    })
    .join(',\n')

  sf.addStatements((writer) => {
    writer.blankLine()
    writer.writeLine(`export const ${catalogName} = {\n${objectBody}\n} as const satisfies Record<string, IconMeta>`)
    writer.blankLine()
    writer.writeLine(`export type ${keyTypeName} = keyof typeof ${catalogName}`)
  })

  fs.writeFileSync(outPath, sf.getFullText())
}

// ---------------------------------------------------------------------------
// generateCatalog
// ---------------------------------------------------------------------------

/**
 * Generate a catalog.ts that maps camelCase keys to CompoundIcon values.
 * Statically imports every icon component, so it must only ever be reached
 * through a dynamic `import()` (see icons/loader.ts) — a static import would
 * drag the full icon set into the importer's first-paint chunk.
 *
 * The key type comes from meta-catalog.ts; `satisfies Record<Key, CompoundIcon>`
 * guarantees both generated catalogs stay key-identical at compile time.
 *
 * Output:
 *   import type { CompoundIcon } from '../types'
 *   import { type ProviderIconKey } from './meta-catalog'
 *   import { FooIcon } from './foo'
 *   ...
 *   export const PROVIDER_ICON_CATALOG = { foo: FooIcon, ... } as const satisfies Record<ProviderIconKey, CompoundIcon>
 */
export function generateCatalog(opts: {
  outPath: string
  entries: Array<{ dirName: string; colorName: string }>
  catalogName: string
  keyTypeName: string
}): void {
  const { outPath, entries, catalogName, keyTypeName } = opts

  const sf = project.createSourceFile('catalog.ts', '', { overwrite: true })

  sf.addStatements((writer) => {
    writer.writeLine(`/**`)
    writer.writeLine(` * Auto-generated icon catalog for runtime lookup`)
    writer.writeLine(` * Do not edit manually — regenerated by the icon pipeline`)
    writer.writeLine(` *`)
    writer.writeLine(` * Loaded exclusively via dynamic import (icons/loader.ts) — never import statically`)
    writer.writeLine(` *`)
    writer.writeLine(` * Generated at: ${new Date().toISOString()}`)
    writer.writeLine(` * Total icons: ${entries.length}`)
    writer.writeLine(` */`)
  })

  sf.addImportDeclaration({
    moduleSpecifier: '../types',
    namedImports: [{ name: 'CompoundIcon', isTypeOnly: true }]
  })

  sf.addImportDeclaration({
    moduleSpecifier: './meta-catalog',
    namedImports: [{ name: keyTypeName, isTypeOnly: true }]
  })

  for (const { dirName, colorName } of entries) {
    sf.addImportDeclaration({
      moduleSpecifier: `./${dirName}`,
      namedImports: [`${colorName}Icon`]
    })
  }

  // Use raw text to emit `as const satisfies` (ts-morph doesn't support this syntax natively)
  const objectBody = entries
    .map(({ dirName, colorName }) => {
      const key = /^\d/.test(dirName) || dirName.includes('-') ? `'${dirName}'` : dirName
      return `  ${key}: ${colorName}Icon`
    })
    .join(',\n')

  sf.addStatements((writer) => {
    writer.blankLine()
    writer.writeLine(
      `export const ${catalogName} = {\n${objectBody}\n} as const satisfies Record<${keyTypeName}, CompoundIcon>`
    )
  })

  fs.writeFileSync(outPath, sf.getFullText())
}
