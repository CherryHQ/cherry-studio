/**
 * Codemod (cleanup): lift residual axis classes that still sit in the className of
 * a @cherrystudio/ui layout primitive into the matching prop, so the
 * layout-primitives/no-redundant-class lint stops warning.
 *
 * Only un-prefixed, unambiguous tokens are lifted (variant-prefixed `md:flex-row`
 * and arbitrary `gap-[6px]` stay in className). A token is skipped when the element
 * already has the corresponding prop (would conflict) or when it contradicts the
 * primitive's baked direction (e.g. `flex-row` on a VStack). Tokens that merely
 * restate the primitive's baked default are dropped without adding a prop.
 *
 * Usage: tsx scripts/codemods/lift-primitive-axis-classes.ts --glob "<pattern>" [--apply]
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

const PRIMITIVES: Record<string, { direction?: 'row' | 'col'; align?: string; justify?: string }> = {
  HStack: { direction: 'row', align: 'center' },
  VStack: { direction: 'col', align: 'stretch' },
  Stack: { direction: 'col', align: 'stretch' },
  Center: { align: 'center', justify: 'center' },
  Flex: {},
  Grid: {}
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

  let lifted = 0
  const isTarget = (el: JsxElement | JsxSelfClosingElement) => {
    const opening = Node.isJsxSelfClosingElement(el) ? el : el.getOpeningElement()
    return !!PRIMITIVES[opening.getTagNameNode().getText()]
  }

  for (const sourceFile of project.getSourceFiles()) {
    let changed = false
    const elements: (JsxElement | JsxSelfClosingElement)[] = [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)
    ].sort((a, b) => b.getStart() - a.getStart())

    for (const element of elements) {
      if (element.wasForgotten() || !isTarget(element)) continue
      const opening = Node.isJsxSelfClosingElement(element) ? element : element.getOpeningElement()
      const name = opening.getTagNameNode().getText()
      const baked = PRIMITIVES[name]

      const attrs = opening.getAttributes()
      const classAttr = attrs.find((a) => Node.isJsxAttribute(a) && a.getNameNode().getText() === 'className')
      if (!classAttr || !Node.isJsxAttribute(classAttr)) continue
      const init = classAttr.getInitializer()
      if (!init || !Node.isStringLiteral(init)) continue

      const hasProp = (p: string) => attrs.some((a) => Node.isJsxAttribute(a) && a.getNameNode().getText() === p)
      const tokens = init.getLiteralValue().split(/\s+/).filter(Boolean)
      const newProps: string[] = []
      const remaining: string[] = []
      let skip = false

      for (const t of tokens) {
        if (t === 'flex-row' || t === 'flex-col') {
          const dir = t === 'flex-row' ? 'row' : 'col'
          if (baked.direction === dir) continue // redundant with baked direction -> drop
          if (baked.direction) {
            skip = true
            break
          } // contradicts baked direction -> leave whole element alone
          if (!hasProp('direction')) newProps.push(`direction="${dir}"`)
          else remaining.push(t)
        } else if (ALIGN[t]) {
          if (hasProp('align')) {
            remaining.push(t)
            continue
          }
          if (baked.align === ALIGN[t]) continue // redundant -> drop
          newProps.push(`align="${ALIGN[t]}"`)
        } else if (JUSTIFY[t]) {
          if (hasProp('justify')) {
            remaining.push(t)
            continue
          }
          if (baked.justify === JUSTIFY[t]) continue
          newProps.push(`justify="${JUSTIFY[t]}"`)
        } else if (t === 'flex-wrap') {
          if (hasProp('wrap')) remaining.push(t)
          else newProps.push('wrap')
        } else if (/^gap-\d+(\.\d+)?$/.test(t)) {
          if (hasProp('gap'))
            remaining.push(t) // existing gap prop wins; leave className gap alone
          else newProps.push(`gap={${roundGapDown(Number(t.slice('gap-'.length)))}}`)
        } else {
          remaining.push(t)
        }
      }

      // Nothing to do if we bailed, or neither lifted a prop nor dropped a redundant token.
      if (skip || (newProps.length === 0 && remaining.length === tokens.length)) continue
      lifted += newProps.length + (tokens.length - remaining.length - newProps.length)
      if (!apply) continue

      // Rebuild the element atomically (robust to nesting).
      const otherParts: string[] = []
      for (const a of attrs) {
        if (Node.isJsxAttribute(a) && a.getNameNode().getText() === 'className') continue
        otherParts.push(a.getText())
      }
      const classNamePart = remaining.length > 0 ? [`className="${remaining.join(' ')}"`] : []
      const attrText = [...otherParts, ...newProps, ...classNamePart].join(' ')
      if (Node.isJsxSelfClosingElement(element)) {
        element.replaceWithText(`<${name} ${attrText} />`)
      } else {
        const whole = element.getText()
        const openText = element.getOpeningElement().getText()
        const closeText = element.getClosingElement().getText()
        const inner = whole.slice(openText.length, whole.length - closeText.length)
        element.replaceWithText(`<${name} ${attrText}>${inner}</${name}>`)
      }
      changed = true
    }
    if (apply && changed) void sourceFile
  }

  if (apply) project.saveSync()
  console.log(`${lifted} class(es) ${apply ? 'lifted into props' : '(dry run)'}.`)
}

run()
