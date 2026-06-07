/**
 * Codemod: replace the deprecated @cherrystudio/ui layout presets
 * (RowFlex / ColFlex / SpaceBetweenRowFlex) with the general `Flex` primitive.
 *
 * Usage:
 *   tsx scripts/codemods/deprecated-presets.ts --glob "src/renderer/**\/*.tsx"
 *   tsx scripts/codemods/deprecated-presets.ts --glob "<pattern>" --apply
 *
 * The presets are literally `Flex direction="row|col" [justify="between"]`, so the
 * rename is exactly display-preserving — Flex has no gap/align defaults that could
 * be silently introduced (unlike HStack/VStack, which bake align + gap). When the
 * className is a string literal, the axis tokens (items-*, justify-*, gap-N,
 * flex-wrap, flex-row/col) are lifted into Flex props so the result is also
 * lint-clean; non-literal classNames are left untouched (only the tag is renamed
 * and direction/justify added).
 */

import path from 'node:path'
import process from 'node:process'

import { type JsxElement, type JsxSelfClosingElement, Node, Project, QuoteKind, SyntaxKind } from 'ts-morph'

const PRESETS: Record<string, { direction: 'row' | 'col'; justify?: string }> = {
  RowFlex: { direction: 'row' },
  ColFlex: { direction: 'col' },
  SpaceBetweenRowFlex: { direction: 'row', justify: 'between' }
}

const CANONICAL_GAPS = [0, 1, 2, 3, 4, 5, 6, 8]
function roundGapDown(value: number): number {
  let result = 0
  for (const c of CANONICAL_GAPS) if (c <= value) result = c
  return result
}

const ALIGN: Record<string, string> = {
  'items-start': 'start',
  'items-center': 'center',
  'items-end': 'end',
  'items-stretch': 'stretch',
  'items-baseline': 'baseline'
}
const JUSTIFY: Record<string, string> = {
  'justify-start': 'start',
  'justify-center': 'center',
  'justify-end': 'end',
  'justify-between': 'between',
  'justify-around': 'around',
  'justify-evenly': 'evenly'
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

function run(): void {
  const { globs, apply } = parseArgs(process.argv.slice(2))
  if (globs.length === 0) {
    console.error('Provide at least one --glob "<pattern>".')
    process.exit(1)
  }

  const project = new Project({
    manipulationSettings: { quoteKind: QuoteKind.Single },
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, jsx: 4 }
  })
  for (const glob of globs) project.addSourceFilesAtPaths(path.resolve(process.cwd(), glob))

  let converted = 0
  let changedFiles = 0

  // Read the conversion plan for one preset element (no edits).
  function planElement(element: JsxElement | JsxSelfClosingElement) {
    const opening = Node.isJsxSelfClosingElement(element) ? element : element.getOpeningElement()
    const preset = PRESETS[opening.getTagNameNode().getText()]
    if (!preset) return null
    const props: { direction: string; align?: string; justify?: string; wrap?: boolean; gap?: number } = {
      direction: preset.direction
    }
    if (preset.justify) props.justify = preset.justify

    const classAttr = opening
      .getAttributes()
      .find((a) => Node.isJsxAttribute(a) && a.getNameNode().getText() === 'className')
    let newClassName: string | undefined // undefined = leave untouched
    if (classAttr && Node.isJsxAttribute(classAttr)) {
      const init = classAttr.getInitializer()
      if (init && Node.isStringLiteral(init)) {
        const remaining: string[] = []
        for (const t of init.getLiteralValue().split(/\s+/).filter(Boolean)) {
          if (t === 'flex' || t === 'flex-row' || t === 'flex-col') continue
          else if (ALIGN[t]) props.align = ALIGN[t]
          else if (JUSTIFY[t]) props.justify = JUSTIFY[t]
          else if (t === 'flex-wrap') props.wrap = true
          else if (/^gap-\d+(\.\d+)?$/.test(t)) props.gap = roundGapDown(Number(t.slice('gap-'.length)))
          else remaining.push(t)
        }
        newClassName = remaining.join(' ')
      }
    }
    return { props, newClassName }
  }

  function applyPlan(element: JsxElement | JsxSelfClosingElement, plan: NonNullable<ReturnType<typeof planElement>>) {
    const { props, newClassName } = plan
    const opening = Node.isJsxSelfClosingElement(element) ? element : element.getOpeningElement()

    const layoutParts = [`direction="${props.direction}"`]
    if (props.align) layoutParts.push(`align="${props.align}"`)
    if (props.justify) layoutParts.push(`justify="${props.justify}"`)
    if (props.wrap) layoutParts.push('wrap')
    if (props.gap !== undefined) layoutParts.push(`gap={${props.gap}}`)

    // Preserve every existing attribute except className (which we rewrite from the
    // lifted plan, or keep verbatim when it was a non-literal expression).
    let classNamePart: string | undefined
    const otherParts: string[] = []
    for (const attr of opening.getAttributes()) {
      if (Node.isJsxAttribute(attr) && attr.getNameNode().getText() === 'className') {
        const init = attr.getInitializer()
        if (init && Node.isStringLiteral(init)) {
          if (newClassName) classNamePart = `className="${newClassName}"`
        } else {
          classNamePart = attr.getText()
        }
      } else {
        otherParts.push(attr.getText())
      }
    }

    const attrText = [...layoutParts, ...(classNamePart ? [classNamePart] : []), ...otherParts].join(' ')

    // Replace the whole element in one atomic write — robust against nesting,
    // unlike incremental tag-rename + attribute edits. Inner text is preserved
    // verbatim, so any nested presets are converted on a later re-query pass.
    if (Node.isJsxSelfClosingElement(element)) {
      element.replaceWithText(`<Flex ${attrText} />`)
    } else {
      const whole = element.getText()
      const openText = element.getOpeningElement().getText()
      const closeText = element.getClosingElement().getText()
      const inner = whole.slice(openText.length, whole.length - closeText.length)
      element.replaceWithText(`<Flex ${attrText}>${inner}</Flex>`)
    }
  }

  const isPreset = (el: JsxElement | JsxSelfClosingElement) =>
    !!PRESETS[(Node.isJsxSelfClosingElement(el) ? el : el.getOpeningElement()).getTagNameNode().getText()]

  for (const sourceFile of project.getSourceFiles()) {
    const rel = path.relative(process.cwd(), sourceFile.getFilePath())
    const convertedPresets = new Set<string>()

    if (!apply) {
      // Dry run: read-only snapshot, no edits (so stale nodes are not a concern).
      const elements: (JsxElement | JsxSelfClosingElement)[] = [
        ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement),
        ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)
      ]
      for (const element of elements) {
        const plan = planElement(element)
        if (!plan) continue
        const tag = (Node.isJsxSelfClosingElement(element) ? element : element.getOpeningElement())
          .getTagNameNode()
          .getText()
        console.log(`  ${rel}:${element.getStartLineNumber()}  <${tag}> -> <Flex ${JSON.stringify(plan.props)}>`)
        convertedPresets.add(tag)
        converted++
      }
      continue
    }

    // Apply: re-query the first remaining preset element each iteration so every
    // edit operates on a freshly-fetched node — robust to nesting (no stale refs).
    for (;;) {
      const element =
        sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement).find(isPreset) ??
        sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).find(isPreset)
      if (!element) break
      const tag = (Node.isJsxSelfClosingElement(element) ? element : element.getOpeningElement())
        .getTagNameNode()
        .getText()
      const plan = planElement(element)
      if (!plan) break
      applyPlan(element, plan)
      convertedPresets.add(tag)
      converted++
    }

    if (convertedPresets.size > 0) {
      const importDecl = sourceFile.getImportDeclaration((d) => d.getModuleSpecifierValue() === '@cherrystudio/ui')
      if (importDecl) {
        for (const named of importDecl.getNamedImports()) {
          if (convertedPresets.has(named.getName())) named.remove()
        }
        if (!importDecl.getNamedImports().some((n) => n.getName() === 'Flex')) {
          importDecl.addNamedImport({ name: 'Flex' })
        }
      }
      changedFiles++
    }
  }

  if (apply) project.saveSync()

  console.log(`\n${converted} preset usage(s)${apply ? ` rewritten across ${changedFiles} file(s)` : ' (dry run)'}.`)
}

run()
