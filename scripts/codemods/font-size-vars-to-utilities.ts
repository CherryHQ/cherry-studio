/**
 * Codemod: replace JSX `text-[length:var(--font-size-body-*)]` (and the v4
 * shorthand `text-(length:--font-size-body-*)`) with the `text-*` utility class,
 * and drop the now-redundant paired `leading-[var(--line-height-body-*)]` (the
 * utility carries the design line-height).
 *
 * Only the body scale is migrated (it maps to Tailwind's built-in text-xs/sm/base/lg).
 * `caption` / `section-label` belong to a separate ProviderSettings-scoped theme with
 * no matching utility and are left untouched, as are `.css` files (utilities can't be
 * used there) and unpaired `leading-[var(...)]`.
 *
 * Usage: tsx scripts/codemods/font-size-vars-to-utilities.ts --glob "<pattern>" [--apply]
 */

import path from 'node:path'
import process from 'node:process'

import { Node, Project, QuoteKind, SyntaxKind } from 'ts-morph'

const FS_MAP: Record<string, string> = { 'body-xs': 'xs', 'body-sm': 'sm', 'body-md': 'base', 'body-lg': 'lg' }

function transformClassString(value: string): string {
  const migrated = new Set<string>()
  let out = value
    .replace(/text-\[length:var\(--font-size-(body-(?:xs|sm|md|lg))\)\]/g, (_m, scale) => {
      migrated.add(scale)
      return `text-${FS_MAP[scale]}`
    })
    .replace(/text-\(length:--font-size-(body-(?:xs|sm|md|lg))\)/g, (_m, scale) => {
      migrated.add(scale)
      return `text-${FS_MAP[scale]}`
    })
  // Drop the paired line-height only for scales whose font-size we just migrated.
  for (const scale of migrated) {
    out = out.replace(new RegExp(` ?leading-\\[var\\(--line-height-${scale}\\)\\]`, 'g'), '')
  }
  return out
}

function parseArgs(argv: string[]) {
  const globs: string[] = []
  let apply = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--glob') {
      const v = argv[++i]
      if (v) globs.push(v)
    } else if (argv[i] === '--apply') apply = true
  }
  return { globs, apply }
}

function run() {
  const { globs, apply } = parseArgs(process.argv.slice(2))
  if (!globs.length) {
    console.error('Provide --glob "<pattern>".')
    process.exit(1)
  }
  const project = new Project({
    manipulationSettings: { quoteKind: QuoteKind.Single },
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, jsx: 4 }
  })
  for (const g of globs) project.addSourceFilesAtPaths(path.resolve(process.cwd(), g))

  let changed = 0
  let standalone = 0
  for (const sourceFile of project.getSourceFiles()) {
    let fileChanged = false
    // String literals + no-substitution template literals carry these classNames.
    const strings = [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral)
    ]
    for (const node of strings) {
      if (node.wasForgotten()) continue
      const value = node.getLiteralValue()
      if (!value.includes('--font-size-body-')) continue
      const next = transformClassString(value)
      if (next === value) continue
      changed++
      if (apply) {
        if (Node.isStringLiteral(node)) node.setLiteralValue(next)
        else node.replaceWithText('`' + next + '`')
        fileChanged = true
      }
    }
    // Count unpaired leading-[var(--line-height-body-*)] left behind (reported, not changed).
    for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
      if (node.wasForgotten()) continue
      const v = node.getLiteralValue()
      const m = v.match(/leading-\[var\(--line-height-body-(?:xs|sm|md|lg)\)\]/)
      if (m && !v.includes('--font-size-body-')) standalone++
    }
    void fileChanged
  }
  if (apply) project.saveSync()
  console.log(
    `${changed} className string(s) ${apply ? 'rewritten' : '(dry run)'}; ${standalone} unpaired leading-[var(...)] left as-is.`
  )
}

run()
