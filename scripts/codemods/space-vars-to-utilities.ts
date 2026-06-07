/**
 * Codemod: converge the ProviderSettings scope's private spacing / padding /
 * icon-size tokens (consumed via `*-[length:var(--space-*|--padding-*|--icon-size-*)]`)
 * onto the global spacing scale utilities (`gap-N`/`px-N`/`py-N`/`size-N`).
 *
 * Tailwind's spacing scale (`--spacing: 0.25rem`) makes these value-identical:
 *   --space-inline-md 0.75rem = gap-3, --space-stack-sm 0.625rem = gap-2.5, etc.
 * Two private tokens are off the scale (13px / 3px) and convert to the exact
 * arbitrary value (`size-[13px]` / `py-[3px]`) — de-var'd but not a named token.
 *
 * `--provider-list-row-gap` is intentionally NOT mapped here: it is also read from
 * a TSX inline style (`gap: var(--provider-list-row-gap)`), where a utility class
 * cannot be used, so the token must survive.
 *
 * Usage: tsx scripts/codemods/space-vars-to-utilities.ts --glob "<pattern>" [--apply]
 */

import path from 'node:path'
import process from 'node:process'

import { Node, Project, QuoteKind, SyntaxKind } from 'ts-morph'

const MAP: Record<string, string> = {
  'gap-[length:var(--space-inline-md)]': 'gap-3',
  'gap-[length:var(--space-stack-sm)]': 'gap-2.5',
  'gap-[length:var(--space-stack-lg)]': 'gap-6',
  'px-[length:var(--padding-x-control)]': 'px-3',
  'py-[length:var(--padding-y-control)]': 'py-1.5',
  'px-[length:var(--padding-x-control-compact)]': 'px-2',
  'py-[length:var(--padding-y-control-compact)]': 'py-[3px]',
  'size-[length:var(--icon-size-body-xs)]': 'size-3',
  'size-[length:var(--icon-size-caption)]': 'size-[13px]'
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
