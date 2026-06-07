/**
 * Codemod: replace the `font-[weight:var(--font-weight-X)]` arbitrary-value bypass
 * (and the v4 shorthand `font-(weight:--font-weight-X)`) with the plain `font-X`
 * utility. Tailwind generates `font-medium/normal/semibold/bold/...` from the
 * `--font-weight-*` namespace, so the var() form is just a longhand for the utility.
 *
 * Usage: tsx scripts/codemods/font-weight-vars-to-utilities.ts --glob "<pattern>" [--apply]
 */

import path from 'node:path'
import process from 'node:process'

import { Node, Project, QuoteKind, SyntaxKind } from 'ts-morph'

function transform(value: string): string {
  return value
    .replace(/font-\[weight:var\(--font-weight-([a-z]+)\)\]/g, 'font-$1')
    .replace(/font-\(weight:--font-weight-([a-z]+)\)/g, 'font-$1')
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
      if (!value.includes('--font-weight-')) continue
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
