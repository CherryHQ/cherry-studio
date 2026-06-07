/**
 * Codemod: migrate hand-rolled renderer layout to @cherrystudio/ui layout primitives.
 *
 * Usage:
 *   tsx scripts/codemods/layout-primitives.ts --glob "src/renderer/pages/knowledge/**\/*.tsx"
 *   tsx scripts/codemods/layout-primitives.ts --glob "<pattern>" --apply
 *
 * Default is a DRY-RUN report; pass --apply to write changes.
 *
 * Conservative by design — it only auto-transforms the display-preserving case
 * (`<div className="flex flex-col gap-N …">` → `<VStack gap={N} …>`, both already
 * flex) on a STRING-LITERAL className. The riskier shapes (`space-y-N`, the
 * truncation row) change display semantics or restructure children, so they are
 * REPORTED for hand-migration rather than rewritten.
 *
 * `gap` is normalized to the canonical token scale; off-scale half-steps are
 * rounded DOWN and listed in the report so a reviewer can confirm density.
 */

import path from 'node:path'
import process from 'node:process'

import { type JsxElement, type JsxSelfClosingElement, Node, Project, QuoteKind, SyntaxKind } from 'ts-morph'

const CANONICAL_GAPS = [0, 1, 2, 3, 4, 5, 6, 8]

function roundGapDown(value: number): number {
  let result = 0
  for (const c of CANONICAL_GAPS) if (c <= value) result = c
  return result
}

interface Report {
  vstack: { file: string; line: number; from: string; gap: number; rounded?: { from: number; to: number } }[]
  spaceY: { file: string; line: number; className: string }[]
  truncatingRow: { file: string; line: number; className: string }[]
}

function parseArgs(argv: string[]): { globs: string[]; apply: boolean } {
  const globs: string[] = []
  let apply = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--glob') {
      const value = argv[++i]
      if (value) globs.push(value)
    } else if (argv[i] === '--apply') {
      apply = true
    }
  }
  return { globs, apply }
}

/** Ensure `import { <names> } from '@cherrystudio/ui'` includes each name. */
function ensureNamedImports(sourceFile: ReturnType<Project['addSourceFilesAtPaths']>[number], names: string[]): void {
  const existing = sourceFile.getImportDeclaration((d) => d.getModuleSpecifierValue() === '@cherrystudio/ui')
  if (!existing) {
    sourceFile.addImportDeclaration({
      moduleSpecifier: '@cherrystudio/ui',
      namedImports: names.map((name) => ({ name }))
    })
    return
  }
  const present = new Set(existing.getNamedImports().map((n) => n.getName()))
  for (const name of names) if (!present.has(name)) existing.addNamedImport({ name })
}

function renameTag(element: JsxElement | JsxSelfClosingElement, to: string): void {
  if (Node.isJsxSelfClosingElement(element)) {
    element.getTagNameNode().replaceWithText(to)
    return
  }
  // Rename the closing tag first so the opening edit below never leaves the
  // element transiently unbalanced in a way the manipulation engine rejects.
  element.getClosingElement().getTagNameNode().replaceWithText(to)
  element.getOpeningElement().getTagNameNode().replaceWithText(to)
}

function run(): void {
  const { globs, apply } = parseArgs(process.argv.slice(2))
  if (globs.length === 0) {
    console.error('Provide at least one --glob "<pattern>".')
    process.exit(1)
  }

  const project = new Project({
    manipulationSettings: { quoteKind: QuoteKind.Single },
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, jsx: 4 } // jsx: ReactJSX
  })
  for (const glob of globs) project.addSourceFilesAtPaths(path.resolve(process.cwd(), glob))

  const report: Report = { vstack: [], spaceY: [], truncatingRow: [] }
  let changedFiles = 0

  for (const sourceFile of project.getSourceFiles()) {
    const rel = path.relative(process.cwd(), sourceFile.getFilePath())
    let fileChanged = false
    const needImports = new Set<string>()

    // Snapshot the candidate elements first (editing forgets descendant iterators).
    const elements: (JsxElement | JsxSelfClosingElement)[] = [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)
    ]

    for (const element of elements) {
      if (element.wasForgotten()) continue // a prior edit replaced this subtree
      const opening = Node.isJsxSelfClosingElement(element) ? element : element.getOpeningElement()
      const tag = opening.getTagNameNode().getText()
      if (tag !== 'div') continue

      const classAttr = opening
        .getAttributes()
        .find((a) => Node.isJsxAttribute(a) && a.getNameNode().getText() === 'className')
      if (!classAttr || !Node.isJsxAttribute(classAttr)) continue
      const init = classAttr.getInitializer()
      if (!init || !Node.isStringLiteral(init)) continue // only string-literal classNames

      const className = init.getLiteralValue()
      const tokens = className.split(/\s+/).filter(Boolean)
      const line = element.getStartLineNumber()

      const hasSpaceY = tokens.some((t) => /^space-y-\d/.test(t))
      const isTruncationRow =
        tokens.includes('flex') && tokens.includes('min-w-0') && tokens.some((t) => /^flex-1$/.test(t))

      // --- Auto transform: flex flex-col gap-N -> VStack ---
      const gapTok = tokens.find((t) => /^gap-\d+(\.\d+)?$/.test(t))
      if (tokens.includes('flex') && tokens.includes('flex-col') && gapTok) {
        const raw = Number(gapTok.slice('gap-'.length))
        const rounded = roundGapDown(raw)
        const remaining = tokens.filter((t) => t !== 'flex' && t !== 'flex-col' && t !== gapTok)

        report.vstack.push({
          file: rel,
          line,
          from: className,
          gap: rounded,
          ...(raw !== rounded ? { rounded: { from: raw, to: rounded } } : {})
        })

        if (apply) {
          // Rename the tag(s) first while the element is balanced, then re-fetch the
          // opening element and edit its attributes (the earlier refs are now stale).
          renameTag(element, 'VStack')
          const op = Node.isJsxSelfClosingElement(element) ? element : element.getOpeningElement()
          const ca = op.getAttributes().find((a) => Node.isJsxAttribute(a) && a.getNameNode().getText() === 'className')
          if (ca && Node.isJsxAttribute(ca)) {
            if (remaining.length > 0) ca.setInitializer(`"${remaining.join(' ')}"`)
            else ca.remove()
          }
          op.addAttribute({ name: 'gap', initializer: `{${rounded}}` })
          needImports.add('VStack')
          fileChanged = true
        }
        continue
      }

      // --- Report-only candidates (display/structure change — migrate by hand) ---
      if (isTruncationRow) report.truncatingRow.push({ file: rel, line, className })
      else if (hasSpaceY) report.spaceY.push({ file: rel, line, className })
    }

    if (apply && fileChanged) {
      if (needImports.size > 0) ensureNamedImports(sourceFile, [...needImports])
      changedFiles++
    }
  }

  if (apply) project.saveSync()

  // --- Print report ---
  const log = console.log
  log(`\n=== layout-primitives codemod (${apply ? 'APPLY' : 'dry-run'}) ===`)
  log(`globs: ${globs.join(', ')}`)
  log(`\nVStack auto-transforms (flex flex-col gap-N -> VStack): ${report.vstack.length}`)
  for (const r of report.vstack) {
    const note = r.rounded ? `  ⚠ gap ${r.rounded.from} -> ${r.rounded.to} (rounded down — verify density)` : ''
    log(`  ${r.file}:${r.line}  gap={${r.gap}}${note}`)
  }
  log(`\nTruncatingRow candidates (hand-migrate): ${report.truncatingRow.length}`)
  for (const r of report.truncatingRow) log(`  ${r.file}:${r.line}  "${r.className}"`)
  log(`\nspace-y candidates (hand-migrate to VStack — display change): ${report.spaceY.length}`)
  for (const r of report.spaceY) log(`  ${r.file}:${r.line}  "${r.className}"`)

  if (apply) log(`\nWrote ${changedFiles} file(s).`)
  else log(`\nDry run — re-run with --apply to write the ${report.vstack.length} VStack transform(s).`)
}

run()
