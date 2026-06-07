/**
 * Codemod: de-var the ProviderSettings scope's last live typography tokens.
 *
 * The scope's `caption` tier is 13px / line-height 1.25 — off Tailwind's scale,
 * and the global `text-*` utilities carry much looser line-heights (text-xs is
 * 12px / 20px), so converging to a named utility is NOT value-preserving. The
 * only lossless move is to inline the exact values as arbitrary utilities, which
 * also lets the private tokens be deleted.
 *
 *   text-[length:var(--font-size-caption)]      -> text-[13px]
 *   leading-[(length:)?var(--line-height-caption)]      -> leading-[1.25]
 *   leading-[var(--line-height-section-label)]  -> leading-[1.3]
 *
 * Usage: tsx scripts/codemods/typography-vars-to-literal.ts --glob "<pattern>" [--apply]
 */

import path from 'node:path'
import process from 'node:process'

import { Node, Project, QuoteKind, SyntaxKind } from 'ts-morph'

const MAP: Record<string, string> = {
  'text-[length:var(--font-size-caption)]': 'text-[13px]',
  'leading-[length:var(--line-height-caption)]': 'leading-[1.25]',
  'leading-[var(--line-height-caption)]': 'leading-[1.25]',
  'leading-[var(--line-height-section-label)]': 'leading-[1.3]'
}

function transform(value: string): string {
  let next = value
  for (const [from, to] of Object.entries(MAP)) {
    if (next.includes(from)) next = next.split(from).join(to)
  }
  return next
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
  for (const sourceFile of project.getSourceFiles()) {
    const nodes = [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral)
    ]
    for (const node of nodes) {
      if (node.wasForgotten()) continue
      const value = node.getLiteralValue()
      const next = transform(value)
      if (next === value) continue
      changed++
      if (apply) {
        if (Node.isStringLiteral(node)) node.setLiteralValue(next)
        else node.replaceWithText('`' + next + '`')
      }
    }
  }
  if (apply) project.saveSync()
  console.log(`${changed} className string(s) ${apply ? 'rewritten' : '(dry run)'}.`)
}

run()
