/**
 * Shared code generators using ts-morph for AST-level TypeScript generation.
 *
 * Provides a single source of truth for all generated file shapes:
 *   - generateIconIndex  — per-icon index.ts (compound export)
 *   - generateAvatar     — per-icon avatar.tsx
 *   - generateMeta       — per-icon meta.ts
 *   - generateBarrelIndex — barrel index.ts (re-exports)
 */

import * as fs from 'fs'
import { Project, VariableDeclarationKind } from 'ts-morph'

const project = new Project({ useInMemoryFileSystem: true })

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

  if (hasAvatar) {
    sf.addImportDeclaration({
      moduleSpecifier: './avatar',
      namedImports: [avatarName]
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

  fs.writeFileSync(outPath, sf.getFullText())
}

// ---------------------------------------------------------------------------
// generateAvatar
// ---------------------------------------------------------------------------

export function generateAvatar(opts: { outPath: string; colorName: string; variant: 'full-bleed' | 'padded' }): void {
  const { outPath, colorName, variant } = opts
  const avatarName = `${colorName}Avatar`

  const sf = project.createSourceFile('avatar.tsx', '', { overwrite: true })

  if (variant === 'padded') {
    sf.addImportDeclaration({
      moduleSpecifier: '../../../primitives/Avatar',
      namedImports: ['Avatar']
    })
  }

  sf.addImportDeclaration({
    moduleSpecifier: '../../../../lib/utils',
    namedImports: ['cn']
  })

  sf.addImportDeclaration({
    moduleSpecifier: '../../types',
    namedImports: [{ name: 'IconAvatarProps', isTypeOnly: true }]
  })

  sf.addImportDeclaration({
    moduleSpecifier: './color',
    namedImports: [colorName]
  })

  if (variant === 'full-bleed') {
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
    <div
      className={cn(
        'overflow-hidden border-[0.5px] border-[var(--color-border)]',
        shape === 'circle' ? 'rounded-full' : 'rounded-[20%]',
        className
      )}
      style={{ width: size, height: size }}>
      <${colorName} style={{ width: size, height: size }} />
    </div>
  )`
    })
  } else {
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
      icon={<${colorName} style={{ width: size * 0.75, height: size * 0.75 }} />}
      radius={shape === 'circle' ? 'full' : 'none'}
      className={cn(
        'overflow-hidden border-[0.5px] border-[var(--color-border)] bg-background',
        shape !== 'circle' && 'rounded-[20%]',
        className
      )}
      style={{ width: size, height: size }}
    />
  )`
    })
  }

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
// generateCatalog
// ---------------------------------------------------------------------------

/**
 * Generate a catalog.ts that maps camelCase keys to CompoundIcon values.
 * Used by the icon registry for runtime lookup.
 *
 * Output:
 *   import type { CompoundIcon } from '../types'
 *   import { FooIcon } from './foo'
 *   ...
 *   export const MODEL_ICON_CATALOG: Record<string, CompoundIcon> = { foo: FooIcon, ... }
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

  sf.addVariableStatement({
    isExported: true,
    declarationKind: VariableDeclarationKind.Const,
    declarations: [
      {
        name: catalogName,
        type: 'Record<string, CompoundIcon>',
        initializer: `{\n${entries
          .map(({ dirName, colorName }) => {
            const key = /^\d/.test(dirName) ? `'${dirName}'` : dirName
            return `  ${key}: ${colorName}Icon`
          })
          .join(',\n')}\n}`
      }
    ]
  })

  fs.writeFileSync(outPath, sf.getFullText())
}
