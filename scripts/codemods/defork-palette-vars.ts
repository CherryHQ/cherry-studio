/**
 * Codemod: migrate ProviderSettings code off the scoped theme's *forked* bare
 * `var(--X)` palette vars onto the global semantic utilities / `--color-*` vars,
 * so the fork (`provider-settings-scoped-theme.css` palette + `--color-*` bridge)
 * can be deleted and the surface inherits the global v2 theme.
 *
 *   border-[color:var(--section-border)]  -> border-border
 *   border-[color:var(--color-border)]    -> border-border        (bypass -> utility)
 *   bg-[var(--accent)]                     -> bg-accent
 *   text-[color:var(--foreground)]         -> text-foreground
 *   bg-[…color-mix(srgb,var(--muted-foreground) 12%…)] -> bg-muted-foreground/12
 *   the `--cherry-*` neutral button palette -> border-border / text-muted-foreground
 *                                              / hover:bg-accent / hover:text-foreground
 *   bare var(--muted-foreground) / var(--background) (JSX props, gradients)
 *                                          -> var(--color-muted-foreground|background)
 *
 * Usage: tsx scripts/codemods/defork-palette-vars.ts --glob "<pattern>" [--apply]
 */

import path from 'node:path'
import process from 'node:process'

import { Node, Project, QuoteKind, SyntaxKind } from 'ts-morph'

// order matters: specific utility forms before the bare-var catch-alls
const MAP: Array<[string, string]> = [
  ['border-[color:var(--section-border)]', 'border-border'],
  ['border-[color:var(--color-border)]', 'border-border'],
  ['bg-[var(--accent)]', 'bg-accent'],
  ['text-[color:var(--foreground)]', 'text-foreground'],
  ['bg-[color:color-mix(in_srgb,var(--muted-foreground)_12%,transparent)]', 'bg-muted-foreground/12'],
  ['border-[var(--cherry-active-border)]', 'border-border'],
  ['text-[var(--cherry-text-muted)]', 'text-muted-foreground'],
  ['hover:bg-[var(--cherry-active-bg)]', 'hover:bg-accent'],
  ['hover:text-[var(--cherry-primary-hover)]', 'hover:text-foreground'],
  ['var(--muted-foreground)', 'var(--color-muted-foreground)'],
  ['var(--background)', 'var(--color-background)']
]

function transform(value: string): string {
  let next = value
  for (const [from, to] of MAP) {
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
  console.log(`${changed} string(s) ${apply ? 'rewritten' : '(dry run)'}.`)
}

run()
