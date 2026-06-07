/**
 * Codemod: converge the ProviderSettings scope's transparent-backed "soft" color
 * tokens (`color-mix(in srgb, var(--X) N%, transparent)`, consumed via
 * `bg-[var(--color-*-soft)]` / `border-[color:var(--color-*)]` / `text-[color:…]`)
 * onto the global semantic color + opacity utilities (`bg-foreground/4`, etc.).
 *
 * Each token is a single base color at a fixed opacity, so it maps 1:1 to a
 * `{bg,border,text}-{color}/{N}` utility. The scope already bridges `--color-*`
 * to the same (possibly forked) base values, so the base color is preserved.
 *
 * Caveat: Tailwind's `/N` modifier mixes in oklab (srgb fallback), whereas the
 * tokens mix in srgb — an imperceptible shift at these opacities, not byte-exact.
 *
 * NOT mapped: the two "soft" tokens that mix over `var(--background)` instead of
 * transparent (`--color-surface-warning-soft`, `--color-surface-info-soft`) —
 * an opaque tint has no `/N` equivalent, so those stay as scope tokens.
 *
 * Usage: tsx scripts/codemods/soft-color-vars-to-opacity.ts --glob "<pattern>" [--apply]
 */

import path from 'node:path'
import process from 'node:process'

import { Node, Project, QuoteKind, SyntaxKind } from 'ts-morph'

// scope token name (without `--color-` prefix) -> `{color}/{opacity}`
const COLOR: Record<string, string> = {
  'surface-fg-subtle': 'foreground/4',
  'border-fg-muted': 'foreground/12',
  'border-fg-hairline': 'foreground/6',
  'surface-fg-sunken': 'foreground/3',
  'surface-hover-soft': 'accent/40',
  'border-warning-soft': 'destructive/22',
  'border-default-soft': 'border/25',
  'fg-subtle': 'foreground/70',
  'border-info-soft': 'foreground/12'
}

function transform(value: string): string {
  let next = value
  for (const [token, util] of Object.entries(COLOR)) {
    for (const bracket of [`[var(--color-${token})]`, `[color:var(--color-${token})]`]) {
      if (next.includes(bracket)) next = next.split(bracket).join(util)
    }
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
