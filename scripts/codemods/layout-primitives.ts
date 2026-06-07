/**
 * Codemod: migrate hand-rolled renderer layout to @cherrystudio/ui layout primitives.
 *
 * Usage:
 *   tsx scripts/codemods/layout-primitives.ts --glob "src/renderer/pages/knowledge/**\/*.tsx"
 *   tsx scripts/codemods/layout-primitives.ts --glob "<pattern>" --apply
 *
 * Default is a DRY-RUN report; pass --apply to write changes.
 *
 * Conservative by design — it only auto-transforms display-preserving shapes on a
 * STRING-LITERAL className (the element is already flex/grid, so swapping the tag +
 * lifting the axis tokens into props changes nothing visually):
 *   - `flex flex-col min-h-0 flex-1 [overflow-*]`        -> <PageShell [scroll]>
 *   - `flex flex-col gap-N`                              -> <VStack gap={N}>
 *   - `flex items-center gap-N` (not a truncation row)   -> <HStack gap={N}>
 *   - `grid grid-cols-N gap-K` (no responsive/arbitrary) -> <Grid columns={N} gap={K}>
 * The riskier shapes (the truncation row, `space-y-N`, responsive/arbitrary grids)
 * change display semantics or restructure children, so they are REPORTED for
 * hand-migration rather than rewritten.
 *
 * `gap` is normalized to the canonical token scale; off-scale half-steps are
 * rounded DOWN and listed in the report so a reviewer can confirm density.
 */

import path from 'node:path'
import process from 'node:process'

import {
  type JsxAttributeStructure,
  type JsxElement,
  type JsxSelfClosingElement,
  Node,
  type OptionalKind,
  Project,
  QuoteKind,
  SyntaxKind
} from 'ts-morph'

const CANONICAL_GAPS = [0, 1, 2, 3, 4, 5, 6, 8]

function roundGapDown(value: number): number {
  let result = 0
  for (const c of CANONICAL_GAPS) if (c <= value) result = c
  return result
}

interface Report {
  vstack: { file: string; line: number; gap: number; rounded?: { from: number; to: number } }[]
  hstack: { file: string; line: number; gap: number; rounded?: { from: number; to: number } }[]
  pageShell: { file: string; line: number; scroll: boolean }[]
  grid: { file: string; line: number; columns: number }[]
  spaceY: { file: string; line: number; className: string }[]
  truncatingRow: { file: string; line: number; className: string }[]
  gridResponsive: { file: string; line: number; className: string }[]
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

type SourceFile = ReturnType<Project['addSourceFilesAtPaths']>[number]

/** Ensure `import { <names> } from '@cherrystudio/ui'` includes each name. */
function ensureNamedImports(sourceFile: SourceFile, names: string[]): void {
  // Prefer a value (non-type-only) import — a `import type {…}` declaration cannot
  // hold value imports, so adding to it would make the primitive type-only (TS1361).
  const existing = sourceFile
    .getImportDeclarations()
    .find((d) => d.getModuleSpecifierValue() === '@cherrystudio/ui' && !d.isTypeOnly())
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

/**
 * Rename the element to `to`, set its className to `remaining`, and prepend `attrs`,
 * by rewriting the whole element in ONE atomic `replaceWithText`. Incremental
 * tag-rename + attribute edits corrupt ts-morph's tree on nested cases; an atomic
 * replace preserves inner text verbatim (nested matches convert on a later pass).
 */
function transformElement(
  element: JsxElement | JsxSelfClosingElement,
  to: string,
  remaining: string[],
  attrs: OptionalKind<JsxAttributeStructure>[]
): void {
  const opening = Node.isJsxSelfClosingElement(element) ? element : element.getOpeningElement()
  const otherParts: string[] = []
  for (const attr of opening.getAttributes()) {
    if (Node.isJsxAttribute(attr) && attr.getNameNode().getText() === 'className') continue
    otherParts.push(attr.getText())
  }
  const attrParts = attrs.map((a) => (a.initializer !== undefined ? `${a.name}=${a.initializer}` : (a.name as string)))
  const classNamePart = remaining.length > 0 ? [`className="${remaining.join(' ')}"`] : []
  const attrText = [...attrParts, ...classNamePart, ...otherParts].join(' ')

  if (Node.isJsxSelfClosingElement(element)) {
    element.replaceWithText(`<${to} ${attrText} />`)
  } else {
    const whole = element.getText()
    const openText = element.getOpeningElement().getText()
    const closeText = element.getClosingElement().getText()
    const inner = whole.slice(openText.length, whole.length - closeText.length)
    element.replaceWithText(`<${to} ${attrText}>${inner}</${to}>`)
  }
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

  const report: Report = {
    vstack: [],
    hstack: [],
    pageShell: [],
    grid: [],
    spaceY: [],
    truncatingRow: [],
    gridResponsive: []
  }
  let changedFiles = 0

  for (const sourceFile of project.getSourceFiles()) {
    const rel = path.relative(process.cwd(), sourceFile.getFilePath())
    let fileChanged = false
    const needImports = new Set<string>()

    // Snapshot the candidate elements, then process them bottom-up (deepest/last
    // first). Editing an element shifts the text after it, so transforming an outer
    // element before an inner one would invalidate the inner node; going last-first
    // means every edit only touches text past elements we have already handled.
    const elements: (JsxElement | JsxSelfClosingElement)[] = [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)
    ].sort((a, b) => b.getStart() - a.getStart())

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
      const has = (t: string) => tokens.includes(t)
      const line = element.getStartLineNumber()

      const gapTok = tokens.find((t) => /^gap-\d+(\.\d+)?$/.test(t))
      const rawGap = gapTok ? Number(gapTok.slice('gap-'.length)) : undefined
      const roundedGap = rawGap !== undefined ? roundGapDown(rawGap) : undefined
      const gapNote =
        rawGap !== undefined && rawGap !== roundedGap ? { from: rawGap, to: roundedGap as number } : undefined

      const hasFlex1 = tokens.some((t) => t === 'flex-1')
      const isTruncationRow = has('flex') && has('min-w-0') && hasFlex1 && !has('flex-col')

      const markChanged = (name: string) => {
        needImports.add(name)
        fileChanged = true
      }

      // --- PageShell: flex flex-col min-h-0 flex-1 overflow-* fill shell ---
      // Require an explicit overflow class so the transform stays display-preserving
      // (PageShell defaults to overflow-hidden; adding it to a shell that had none
      // would silently introduce clipping). Overflow-less shells are reported instead.
      const hasOverflow = has('overflow-hidden') || has('overflow-y-auto') || has('overflow-auto')
      if (has('flex') && has('flex-col') && has('min-h-0') && hasFlex1 && hasOverflow) {
        const scroll = has('overflow-y-auto') || has('overflow-auto')
        const consumed = new Set([
          'flex',
          'flex-col',
          'min-h-0',
          'flex-1',
          'overflow-hidden',
          'overflow-y-auto',
          'overflow-auto'
        ])
        const remaining = tokens.filter((t) => !consumed.has(t) && t !== gapTok)
        report.pageShell.push({ file: rel, line, scroll })
        if (apply) {
          const attrs: OptionalKind<JsxAttributeStructure>[] = []
          if (scroll) attrs.push({ name: 'scroll' })
          if (roundedGap !== undefined && roundedGap !== 0) attrs.push({ name: 'gap', initializer: `{${roundedGap}}` })
          transformElement(element, 'PageShell', remaining, attrs)
          markChanged('PageShell')
        }
        continue
      }

      // --- VStack: flex flex-col gap-N ---
      if (has('flex') && has('flex-col') && gapTok) {
        const remaining = tokens.filter((t) => t !== 'flex' && t !== 'flex-col' && t !== gapTok)
        report.vstack.push({ file: rel, line, gap: roundedGap as number, ...(gapNote ? { rounded: gapNote } : {}) })
        if (apply) {
          transformElement(element, 'VStack', remaining, [{ name: 'gap', initializer: `{${roundedGap}}` }])
          markChanged('VStack')
        }
        continue
      }

      // --- HStack: flex items-center gap-N (vertically-centered row, not a truncation row) ---
      if (has('flex') && has('items-center') && gapTok && !has('flex-col') && !isTruncationRow) {
        const remaining = tokens.filter((t) => t !== 'flex' && t !== 'items-center' && t !== gapTok)
        report.hstack.push({ file: rel, line, gap: roundedGap as number, ...(gapNote ? { rounded: gapNote } : {}) })
        if (apply) {
          transformElement(element, 'HStack', remaining, [{ name: 'gap', initializer: `{${roundedGap}}` }])
          markChanged('HStack')
        }
        continue
      }

      // --- Grid: grid grid-cols-N gap-K (single column count, no responsive/arbitrary) ---
      if (has('grid')) {
        const baseCol = tokens.find((t) => /^grid-cols-\d+$/.test(t))
        const responsiveOrArbitrary = tokens.some((t) => /^(sm|md|lg|xl):grid-cols-/.test(t) || /^grid-cols-\[/.test(t))
        if (baseCol && !responsiveOrArbitrary) {
          const cols = Number(baseCol.slice('grid-cols-'.length))
          const remaining = tokens.filter((t) => t !== 'grid' && t !== baseCol && t !== gapTok)
          report.grid.push({ file: rel, line, columns: cols })
          if (apply) {
            // Grid defaults gap=3, so always emit an explicit gap to preserve the original.
            const gridGap = roundedGap ?? 0
            transformElement(element, 'Grid', remaining, [
              { name: 'columns', initializer: `{${cols}}` },
              { name: 'gap', initializer: `{${gridGap}}` }
            ])
            markChanged('Grid')
          }
          continue
        }
        report.gridResponsive.push({ file: rel, line, className })
        continue
      }

      // --- space-y-N on a plain (non-flex/grid) div -> VStack ---
      // VStack's align="stretch" default + gap reproduce a block stack's full-width
      // children and inter-child spacing; only convert true block stacks.
      const spaceYTok = tokens.find((t) => /^space-y-\d+(\.\d+)?$/.test(t))
      if (spaceYTok && !has('flex') && !has('inline-flex') && !has('grid')) {
        const raw = Number(spaceYTok.slice('space-y-'.length))
        const rounded = roundGapDown(raw)
        const remaining = tokens.filter((t) => t !== spaceYTok)
        report.vstack.push({
          file: rel,
          line,
          gap: rounded,
          ...(raw !== rounded ? { rounded: { from: raw, to: rounded } } : {})
        })
        if (apply) {
          transformElement(element, 'VStack', remaining, [{ name: 'gap', initializer: `{${rounded}}` }])
          markChanged('VStack')
        }
        continue
      }

      // --- Report-only candidates (display/structure change — migrate by hand) ---
      if (isTruncationRow) report.truncatingRow.push({ file: rel, line, className })
    }

    if (apply && fileChanged) {
      if (needImports.size > 0) ensureNamedImports(sourceFile, [...needImports])
      changedFiles++
    }
  }

  if (apply) project.saveSync()

  // --- Print report ---
  const log = console.log
  const gapLine = (r: { file: string; line: number; gap: number; rounded?: { from: number; to: number } }) =>
    `  ${r.file}:${r.line}  gap={${r.gap}}${r.rounded ? `  ⚠ gap ${r.rounded.from} -> ${r.rounded.to} (rounded down — verify density)` : ''}`

  log(`\n=== layout-primitives codemod (${apply ? 'APPLY' : 'dry-run'}) ===`)
  log(`globs: ${globs.join(', ')}`)
  log(`\nVStack (flex flex-col gap-N): ${report.vstack.length}`)
  for (const r of report.vstack) log(gapLine(r))
  log(`\nHStack (flex items-center gap-N): ${report.hstack.length}`)
  for (const r of report.hstack) log(gapLine(r))
  log(`\nPageShell (flex flex-col min-h-0 flex-1): ${report.pageShell.length}`)
  for (const r of report.pageShell) log(`  ${r.file}:${r.line}${r.scroll ? '  scroll' : ''}`)
  log(`\nGrid (grid grid-cols-N): ${report.grid.length}`)
  for (const r of report.grid) log(`  ${r.file}:${r.line}  columns={${r.columns}}`)
  log(`\nTruncatingRow candidates (hand-migrate): ${report.truncatingRow.length}`)
  for (const r of report.truncatingRow) log(`  ${r.file}:${r.line}  "${r.className}"`)
  log(`\nspace-y candidates (hand-migrate — display change): ${report.spaceY.length}`)
  for (const r of report.spaceY) log(`  ${r.file}:${r.line}  "${r.className}"`)
  log(`\nResponsive/arbitrary grids (hand-migrate): ${report.gridResponsive.length}`)
  for (const r of report.gridResponsive) log(`  ${r.file}:${r.line}  "${r.className}"`)

  const autoCount = report.vstack.length + report.hstack.length + report.pageShell.length + report.grid.length
  if (apply) log(`\nWrote ${changedFiles} file(s).`)
  else log(`\nDry run — re-run with --apply to write the ${autoCount} auto-transform(s).`)
}

run()
