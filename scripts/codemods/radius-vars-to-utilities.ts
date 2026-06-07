/**
 * Codemod: replace the `rounded-[length:var(--radius-X)]` arbitrary-value bypass
 * (and the `--cs-radius-X` / v4 shorthand variants) with the plain `rounded-X`
 * utility. Tailwind generates `rounded-{md,lg,xl,4xs,…}` from the `--radius-*`
 * namespace, and the utility resolves the very same `var(--radius-X)` — so the
 * conversion is value-identical even where a scope overrides `--radius-X`.
 *
 * `--radius-control` is a semantic alias for `--radius-lg`, so it maps to `rounded-lg`.
 *
 * Usage: tsx scripts/codemods/radius-vars-to-utilities.ts --glob "<pattern>" [--apply]
 */

import path from 'node:path'
import process from 'node:process'

import { Node, Project, QuoteKind, SyntaxKind } from 'ts-morph'

const ALIAS: Record<string, string> = { control: 'lg' }

function normalize(scale: string): string {
  return ALIAS[scale] ?? scale
}

function transform(value: string): string {
  return value
    .replace(/rounded-\[length:var\(--radius-([a-z0-9]+)\)\]/g, (_, s) => `rounded-${normalize(s)}`)
    .replace(/rounded-\(length:--radius-([a-z0-9]+)\)/g, (_, s) => `rounded-${normalize(s)}`)
    .replace(/rounded-\[length:var\(--cs-radius-([a-z0-9]+)\)\]/g, (_, s) => `rounded-${s}`)
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
      if (!value.includes('radius-')) continue
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
