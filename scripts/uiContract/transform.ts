import {
  type JSXAttribute,
  type JSXElementName,
  type JSXOpeningElement,
  parseSync,
  type Span,
  type SpreadElement
} from '@swc/core'
import { Parser } from 'htmlparser2'
import MagicString from 'magic-string'

import { inferHandlerAction, inferSemanticId } from './semanticId'
import type { UiNodeDescriptor, UiSourceTransform } from './types'

const SKIPPED_COMPONENTS = new Set(['Consumer', 'Fragment', 'Provider', 'StrictMode', 'Suspense'])
const SKIPPED_HTML_TAGS = new Set(['base', 'head', 'html', 'link', 'meta', 'script', 'style', 'title'])
const NON_DOM_COMPONENTS = new Set([
  'ContextMenuPrimitive.Portal',
  'ContextMenuPrimitive.Root',
  'ContextMenuPrimitive.Sub',
  'DialogPortal',
  'DialogPrimitive.Portal',
  'DialogPrimitive.Root',
  'DrawerPortal',
  'DrawerPrimitive.Portal',
  'DrawerPrimitive.Root',
  'DropdownMenuPrimitive.Portal',
  'DropdownMenuPrimitive.Root',
  'DropdownMenuPrimitive.Sub',
  'HoverCardPrimitive.Root',
  'PopoverPrimitive.Root',
  'RadixProvider',
  'RadixRoot',
  'SelectPrimitive.Root'
])
const BOUNDARY_ATTRIBUTES = ['data-testid', 'id', 'name', 'role']
const SVG_OPT_IN_ATTRIBUTES = ['data-testid', 'role']
const DATA_SLOT_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:~-]*$/
export const UI_CONTRACT_RUNTIME_MODULE_ID = 'virtual:cherry-ui-contract-runtime'

const RUNTIME_MERGE_DATA_UI = '__cherryUiContractMergeDataUi'
const RUNTIME_MERGE_UI_PROPS = '__cherryUiContractMergeUiProps'
const RUNTIME_SLOT = '__CherryUiContractSlot'

type AstRecord = Record<string, unknown> & { span?: Span; type?: string }

interface AttributeInfo {
  attribute?: JSXAttribute
  dynamic: boolean
  value?: string
}

interface OpeningElementInfo {
  attributes: Map<string, AttributeInfo>
  authoredDataUi?: string
  element: string
  handler?: string
  parts: string[]
  requiresDataUiInjection: boolean
  spreads: SpreadElement[]
}

function hasSvgContractOptIn(info: OpeningElementInfo): boolean {
  return (
    info.attributes.has('data-ui') ||
    info.parts.length > 0 ||
    SVG_OPT_IN_ATTRIBUTES.some((name) => hasStaticAttribute(info.attributes, name)) ||
    inferHandlerAction(info.handler) !== undefined
  )
}

function hasSemanticSignal(info: OpeningElementInfo): boolean {
  return (
    info.attributes.has('data-ui') ||
    info.parts.length > 0 ||
    BOUNDARY_ATTRIBUTES.some((name) => hasStaticAttribute(info.attributes, name)) ||
    inferHandlerAction(info.handler) !== undefined
  )
}

function hasStaticAttribute(attributes: Map<string, AttributeInfo>, name: string): boolean {
  const attribute = attributes.get(name)
  return Boolean(attribute && !attribute.dynamic && attribute.value)
}

function isRecord(value: unknown): value is AstRecord {
  return typeof value === 'object' && value !== null
}

function jsxName(name: JSXElementName): string {
  if (name.type === 'Identifier') return name.value
  if (name.type === 'JSXNamespacedName') return `${name.namespace.value}:${name.name.value}`
  return `${jsxName(name.object)}.${name.property.value}`
}

function expressionIdentifier(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  if (value.type === 'Identifier' && typeof value.value === 'string') return value.value
  if (value.type === 'MemberExpression' && isRecord(value.property)) {
    const property = expressionIdentifier(value.property)
    return property
  }
  if ((value.type === 'CallExpression' || value.type === 'OptionalChainingExpression') && isRecord(value.callee)) {
    return expressionIdentifier(value.callee)
  }
  return undefined
}

function directHandlerIdentifier(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  if (value.type === 'Identifier' && typeof value.value === 'string') return value.value
  if (value.type === 'MemberExpression' && isRecord(value.property)) {
    return directHandlerIdentifier(value.property)
  }
  if (value.type === 'OptionalChainingExpression' && isRecord(value.base)) {
    return directHandlerIdentifier(value.base)
  }
  return undefined
}

function staticJsxAttribute(attribute: JSXAttribute): AttributeInfo {
  if (!attribute.value) return { attribute, dynamic: false, value: '' }
  if (attribute.value.type === 'StringLiteral') {
    return { attribute, dynamic: false, value: attribute.value.value }
  }
  if (attribute.value.type === 'JSXExpressionContainer') {
    const expression = attribute.value.expression
    if (expression.type === 'StringLiteral') {
      return { attribute, dynamic: false, value: expression.value }
    }
  }
  return { attribute, dynamic: true }
}

function namespaceTokenValues(value: string | undefined, namespace: string): string[] {
  const prefix = `${namespace}:`
  return (value ?? '')
    .split(/\s+/)
    .filter((token) => token.startsWith(prefix) && token.length > prefix.length)
    .map((token) => token.slice(prefix.length))
}

function staticDataSlot(attributes: Map<string, AttributeInfo>): string | undefined {
  const dataSlot = attributes.get('data-slot')
  if (!dataSlot) return undefined
  if (dataSlot.dynamic || !dataSlot.value || !DATA_SLOT_VALUE.test(dataSlot.value)) {
    throw new Error('data-slot must be a static token')
  }
  return dataSlot.value
}

function openingElementInfo(opening: JSXOpeningElement): OpeningElementInfo {
  const attributes = new Map<string, AttributeInfo>()
  const spreads: SpreadElement[] = []
  let handler: string | undefined

  for (const attribute of opening.attributes) {
    if (attribute.type === 'SpreadElement') {
      spreads.push(attribute)
      continue
    }
    if (attribute.type !== 'JSXAttribute' || attribute.name.type !== 'Identifier') continue
    const name = attribute.name.value
    const info = staticJsxAttribute(attribute)
    attributes.set(name, info)
    if (/^on[A-Z]/.test(name) && attribute.value?.type === 'JSXExpressionContainer') {
      const candidate = directHandlerIdentifier(attribute.value.expression)
      if (candidate && (handler === undefined || inferHandlerAction(candidate))) {
        handler = candidate
      }
    }
  }

  const element = jsxName(opening.name)
  const dataSlotPart = staticDataSlot(attributes)
  const parts = [...new Set([...namespaceTokenValues(attributes.get('data-ui')?.value, 'part'), dataSlotPart])].filter(
    (part): part is string => Boolean(part)
  )
  const staticDataUi = attributes.get('data-ui')?.dynamic ? undefined : attributes.get('data-ui')?.value
  const authoredDataUi = mergePartsDataUi(staticDataUi, parts)

  return {
    attributes,
    authoredDataUi,
    element,
    handler,
    parts,
    requiresDataUiInjection: authoredDataUi !== staticDataUi,
    spreads
  }
}

function explicitSemanticId(dataUi: AttributeInfo | undefined): string | undefined {
  if (!dataUi?.value || dataUi.dynamic) return undefined
  return dataUi.value.split(/\s+/).find((token) => token && !token.includes(':'))
}

function dynamicUiSemanticId(dataUi: AttributeInfo | undefined): string | undefined {
  const value = dataUi?.attribute?.value
  if (!dataUi?.dynamic || value?.type !== 'JSXExpressionContainer' || value.expression.type !== 'CallExpression') {
    return undefined
  }
  if (expressionIdentifier(value.expression.callee) !== 'uiTokens') return undefined
  const firstArgument = value.expression.arguments[0]
  if (!firstArgument || firstArgument.spread || firstArgument.expression.type !== 'StringLiteral') return undefined
  return firstArgument.expression.value
}

function byteOffsetMap(source: string): (byteOffset: number) => number {
  const offsets = new Map<number, number>([[0, 0]])
  let bytes = 0
  let characters = 0
  for (const character of source) {
    bytes += Buffer.byteLength(character)
    characters += character.length
    offsets.set(bytes, characters)
  }

  return (byteOffset: number): number => {
    const exact = offsets.get(byteOffset)
    if (exact !== undefined) return exact
    throw new Error(`Invalid UTF-8 byte offset ${byteOffset}`)
  }
}

function leadingTriviaByteLength(source: string): number {
  let index = 0

  while (index < source.length) {
    if (/\s/u.test(source[index])) {
      index += 1
      continue
    }
    if (source.startsWith('//', index) || source.startsWith('#!', index)) {
      const newline = source.indexOf('\n', index + 2)
      index = newline === -1 ? source.length : newline + 1
      continue
    }
    if (source.startsWith('/*', index)) {
      const closing = source.indexOf('*/', index + 2)
      index = closing === -1 ? source.length : closing + 2
      continue
    }
    break
  }

  return Buffer.byteLength(source.slice(0, index))
}

function componentNameFromNode(node: AstRecord): string | undefined {
  if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && isRecord(node.identifier)) {
    return typeof node.identifier.value === 'string' ? node.identifier.value : undefined
  }
  if (node.type === 'VariableDeclarator' && isRecord(node.id) && node.id.type === 'Identifier' && isRecord(node.init)) {
    if (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression') {
      return typeof node.id.value === 'string' ? node.id.value : undefined
    }
  }
  return undefined
}

function defaultComponentName(sourceFile: string): string {
  const filename =
    sourceFile
      .split('/')
      .at(-1)
      ?.replace(/\.(?:jsx|tsx)$/, '') ?? 'Anonymous'
  return filename === 'index' ? (sourceFile.split('/').at(-2) ?? 'Anonymous') : filename
}

function mergeDataUi(existing: string | undefined, semanticId: string): string {
  const existingTokens = (existing ?? '').split(/\s+/).filter(Boolean)
  const semanticTokens = existingTokens.filter((token) => !token.includes(':'))
  const partTokens = existingTokens.filter((token) => token.startsWith('part:'))
  return [...new Set([semanticId, ...semanticTokens, ...partTokens])].join(' ')
}

function mergePartsDataUi(existing: string | undefined, parts: string[]): string | undefined {
  if (!existing && parts.length === 0) return undefined
  const existingTokens = (existing ?? '').split(/\s+/).filter(Boolean)
  const semanticTokens = existingTokens.filter((token) => !token.includes(':'))
  const partTokens = [
    ...existingTokens.filter((token) => token.startsWith('part:')),
    ...parts.map((part) => `part:${part}`)
  ]
  return [...new Set([...semanticTokens, ...partTokens])].join(' ')
}

interface TransformJsxOptions {
  injectDataUi?: boolean
  sourceFile: string
}

export function transformJsx(source: string, options: TransformJsxOptions): UiSourceTransform {
  const module = parseSync(source, {
    syntax: 'typescript',
    tsx: true,
    decorators: true,
    dynamicImport: true
  })
  const magicString = new MagicString(source)
  const byteToCharacter = byteOffsetMap(source)
  // SWC uses process-wide byte positions across parse calls, while module.span.start
  // points at the first syntax token after leading trivia. Recover this file's base
  // before translating its byte positions into JavaScript character offsets.
  const spanBase = module.span.start - leadingTriviaByteLength(source)
  const spanToCharacter = (value: number) => byteToCharacter(value - spanBase)
  const descriptors: UiNodeDescriptor[] = []
  const runtimeImports = new Set<'mergeDataUi' | 'mergeUiProps' | 'UiDataSlot'>()

  function expressionSource(span: Span): string {
    return source.slice(spanToCharacter(span.start), spanToCharacter(span.end))
  }

  function requiredSpan(value: unknown, description: string): Span {
    const span = isRecord(value) ? value.span : undefined
    if (!span) throw new Error(`Missing ${description} span`)
    return span
  }

  function injectDataUi(opening: JSXOpeningElement, existing: AttributeInfo | undefined, contract: string): void {
    const dynamicExpressions: string[] = []
    const attribute = existing?.attribute
    if (
      existing?.dynamic &&
      attribute?.value?.type === 'JSXExpressionContainer' &&
      attribute.value.expression.type !== 'JSXEmptyExpression'
    ) {
      dynamicExpressions.push(expressionSource(requiredSpan(attribute.value.expression, 'data-ui expression')))
    }

    if (attribute) {
      magicString.remove(spanToCharacter(attribute.span.start), spanToCharacter(attribute.span.end))
    }

    const nameSpan = (opening.name as unknown as AstRecord).span
    if (!nameSpan) throw new Error(`Missing JSX element-name span for ${jsxName(opening.name)}`)
    const dataUiValue =
      dynamicExpressions.length > 0
        ? `{${RUNTIME_MERGE_DATA_UI}(${JSON.stringify(contract)}, ${dynamicExpressions.join(', ')})}`
        : JSON.stringify(contract)
    magicString.appendLeft(spanToCharacter(nameSpan.end), ` data-ui=${dataUiValue}`)
    if (dynamicExpressions.length > 0) runtimeImports.add('mergeDataUi')

    for (const spread of opening.attributes) {
      if (spread.type !== 'SpreadElement') continue
      const spreadSpan = requiredSpan(spread.arguments, 'JSX spread expression')
      const spreadSource = expressionSource(spreadSpan)
      magicString.overwrite(
        spanToCharacter(spreadSpan.start),
        spanToCharacter(spreadSpan.end),
        `${RUNTIME_MERGE_UI_PROPS}(${spreadSource}, ${JSON.stringify(contract)})`
      )
      runtimeImports.add('mergeUiProps')
    }
  }

  function processOpening(
    opening: JSXOpeningElement,
    component: string,
    insideSvg: boolean,
    hasBoundaryAncestor: boolean,
    nearestSemanticId: string | undefined
  ): string | undefined {
    const info = openingElementInfo(opening)
    const elementLeaf = info.element.split('.').at(-1) ?? info.element
    if (SKIPPED_COMPONENTS.has(elementLeaf) || NON_DOM_COMPONENTS.has(info.element)) return
    if (SKIPPED_HTML_TAGS.has(info.element)) return

    const existingDataUi = info.attributes.get('data-ui')
    const dynamicSemanticId = dynamicUiSemanticId(existingDataUi)
    const explicitSemantic = explicitSemanticId(existingDataUi) ?? dynamicSemanticId
    const isIntrinsicElement = /^[a-z]/.test(info.element)
    if (!isIntrinsicElement) {
      if (
        options.injectDataUi &&
        info.authoredDataUi &&
        (info.requiresDataUiInjection || (existingDataUi?.value && !existingDataUi.dynamic && info.spreads.length > 0))
      ) {
        injectDataUi(opening, existingDataUi, info.authoredDataUi)
      }
      if (!explicitSemantic) return
      descriptors.push({
        component,
        element: info.element,
        kind: 'jsx',
        semanticId: explicitSemantic,
        semanticSource: 'explicit',
        sourceFile: options.sourceFile,
        sourceOffset: spanToCharacter(opening.span.start)
      })
      return explicitSemantic
    }
    if (insideSvg && info.element !== 'svg' && !hasSvgContractOptIn(info)) return
    if (hasBoundaryAncestor && !hasSemanticSignal(info)) return

    const semanticId =
      explicitSemantic ??
      inferSemanticId({
        component,
        element: info.element,
        handler: info.handler,
        htmlId: info.attributes.get('id')?.value,
        isComponentRoot: !hasBoundaryAncestor,
        name: info.attributes.get('name')?.value,
        part: info.parts[0],
        role: info.attributes.get('role')?.value,
        sourceFile: options.sourceFile,
        testId: info.attributes.get('data-testid')?.value,
        type: info.attributes.get('type')?.value
      })
    if (!explicitSemantic && !info.authoredDataUi && semanticId === nearestSemanticId) return undefined
    const descriptor: UiNodeDescriptor = {
      component,
      element: info.element,
      kind: 'jsx',
      semanticId,
      semanticSource: explicitSemantic ? 'explicit' : 'inferred',
      sourceFile: options.sourceFile,
      sourceOffset: spanToCharacter(opening.span.start)
    }
    descriptors.push(descriptor)

    if (options.injectDataUi) {
      injectDataUi(opening, existingDataUi, mergeDataUi(info.authoredDataUi, descriptor.semanticId))
    }
    return semanticId
  }

  function shouldWrapAsChildContent(opening: JSXOpeningElement): boolean {
    const attribute = opening.attributes.find(
      (attribute) =>
        attribute.type === 'JSXAttribute' && attribute.name.type === 'Identifier' && attribute.name.value === 'asChild'
    )
    if (!attribute || attribute.type !== 'JSXAttribute') return false
    if (!attribute.value) return true

    return !(
      attribute.value.type === 'JSXExpressionContainer' &&
      attribute.value.expression.type === 'BooleanLiteral' &&
      !attribute.value.expression.value
    )
  }

  function walk(
    value: unknown,
    component: string,
    insideSvg = false,
    hasBoundaryAncestor = false,
    nearestSemanticId?: string
  ): void {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, component, insideSvg, hasBoundaryAncestor, nearestSemanticId)
      return
    }
    if (!isRecord(value)) return

    const nestedComponent = componentNameFromNode(value) ?? component
    if (value.type === 'JSXElement' && isRecord(value.opening) && value.opening.type === 'JSXOpeningElement') {
      const opening = value.opening as unknown as JSXOpeningElement
      const element = jsxName(opening.name)
      const isIntrinsicElement = /^[a-z]/.test(element)
      const semanticId = processOpening(opening, nestedComponent, insideSvg, hasBoundaryAncestor, nearestSemanticId)
      const childrenInsideSvg = element === 'foreignObject' ? false : insideSvg || element === 'svg'
      const elementLeaf = element.split('.').at(-1) ?? element
      // Visual component implementations are transformed independently, so their
      // callers already establish a parent boundary. Transparent primitives are
      // listed above and deliberately leave their children as new roots.
      const isComponentBoundary =
        !isIntrinsicElement && !SKIPPED_COMPONENTS.has(elementLeaf) && !NON_DOM_COMPONENTS.has(element)
      const childrenHaveBoundaryAncestor =
        element === 'foreignObject' ? false : hasBoundaryAncestor || isIntrinsicElement || isComponentBoundary
      const childSemanticId = semanticId ?? nearestSemanticId
      if (
        options.injectDataUi &&
        !/^[a-z]/.test(element) &&
        shouldWrapAsChildContent(opening) &&
        Array.isArray(value.children) &&
        value.children.length > 0 &&
        isRecord(value.closing) &&
        value.closing.span
      ) {
        magicString.appendLeft(spanToCharacter(opening.span.end), `<${RUNTIME_SLOT}>`)
        magicString.appendLeft(spanToCharacter(value.closing.span.start), `</${RUNTIME_SLOT}>`)
        runtimeImports.add('UiDataSlot')
      }
      if (Array.isArray(value.children)) {
        walk(value.children, nestedComponent, childrenInsideSvg, childrenHaveBoundaryAncestor, childSemanticId)
      }
      for (const attribute of opening.attributes) {
        if (attribute.type === 'JSXAttribute' && attribute.value?.type === 'JSXExpressionContainer') {
          walk(
            attribute.value.expression,
            nestedComponent,
            childrenInsideSvg,
            childrenHaveBoundaryAncestor,
            childSemanticId
          )
        }
      }
      return
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === 'span' || key === 'ctxt' || key === 'type') continue
      walk(child, nestedComponent, insideSvg, hasBoundaryAncestor, nearestSemanticId)
    }
  }

  walk(module, defaultComponentName(options.sourceFile))

  if (options.injectDataUi && runtimeImports.size > 0) {
    const imports = [...runtimeImports]
      .sort()
      .map((name) => {
        if (name === 'mergeDataUi') return `mergeDataUi as ${RUNTIME_MERGE_DATA_UI}`
        if (name === 'mergeUiProps') return `mergeUiProps as ${RUNTIME_MERGE_UI_PROPS}`
        return `UiDataSlot as ${RUNTIME_SLOT}`
      })
      .join(', ')
    const statement = `import { ${imports} } from ${JSON.stringify(UI_CONTRACT_RUNTIME_MODULE_ID)}\n`
    let insertAt = 0
    for (const item of module.body) {
      if (
        item.type !== 'ExpressionStatement' ||
        !isRecord(item.expression) ||
        item.expression.type !== 'StringLiteral'
      ) {
        break
      }
      insertAt = spanToCharacter(item.span.end)
    }
    if (insertAt === 0) magicString.prepend(statement)
    else magicString.appendLeft(insertAt, `\n${statement}`)
  }

  return {
    code: options.injectDataUi ? magicString.toString() : source,
    descriptors,
    map: options.injectDataUi
      ? magicString.generateMap({
          file: options.sourceFile,
          hires: true,
          includeContent: true,
          source: options.sourceFile
        })
      : null
  }
}

interface HtmlTagMatch {
  attributes: Record<string, string>
  end: number
  index: number
  insideSvg: boolean
  name: string
  parentIndex?: number
  source: string
  start: number
}

function htmlTags(source: string): HtmlTagMatch[] {
  const tags: HtmlTagMatch[] = []
  const svgContext: boolean[] = []
  const parentStack: number[] = []
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        const insideSvg = svgContext.at(-1) ?? false
        svgContext.push(name === 'foreignobject' ? false : insideSvg || name === 'svg')
        const start = parser.startIndex
        const end = parser.endIndex + 1
        const index = tags.length
        tags.push({
          attributes,
          end,
          index,
          insideSvg,
          name,
          parentIndex: parentStack.at(-1),
          source: source.slice(start, end),
          start
        })
        parentStack.push(index)
      },
      onclosetag() {
        svgContext.pop()
        parentStack.pop()
      }
    },
    { decodeEntities: false, recognizeSelfClosing: true }
  )
  parser.end(source)
  return tags
}

function htmlAttribute(tag: HtmlTagMatch, name: string): string | undefined {
  return tag.attributes[name.toLowerCase()]
}

function staticHtmlDataSlot(tag: HtmlTagMatch): string | undefined {
  const dataSlot = htmlAttribute(tag, 'data-slot')
  if (dataSlot === undefined) return undefined
  if (!dataSlot || !DATA_SLOT_VALUE.test(dataSlot)) throw new Error('data-slot must be a static token')
  return dataSlot
}

function hasHtmlSvgContractOptIn(tag: HtmlTagMatch): boolean {
  return (
    htmlAttribute(tag, 'data-ui') !== undefined ||
    htmlAttribute(tag, 'data-slot') !== undefined ||
    SVG_OPT_IN_ATTRIBUTES.some((name) => htmlAttribute(tag, name) !== undefined)
  )
}

function hasHtmlSemanticSignal(tag: HtmlTagMatch): boolean {
  return (
    htmlAttribute(tag, 'data-ui') !== undefined ||
    htmlAttribute(tag, 'data-slot') !== undefined ||
    BOUNDARY_ATTRIBUTES.some((name) => htmlAttribute(tag, name) !== undefined)
  )
}

interface TransformHtmlOptions extends TransformJsxOptions {
  windowName: string
}

export function transformHtml(source: string, options: TransformHtmlOptions): UiSourceTransform {
  const magicString = new MagicString(source)
  const descriptors: UiNodeDescriptor[] = []
  const tags = htmlTags(source)

  for (const tag of tags) {
    if (SKIPPED_HTML_TAGS.has(tag.name)) continue
    const dataSlotPart = staticHtmlDataSlot(tag)
    if (tag.insideSvg && tag.name !== 'svg' && !hasHtmlSvgContractOptIn(tag)) continue
    const parent = tag.parentIndex === undefined ? undefined : tags[tag.parentIndex]
    const isBoundaryRoot = parent === undefined || parent.name === 'foreignobject'
    if (!isBoundaryRoot && !hasHtmlSemanticSignal(tag)) continue
    const existing = htmlAttribute(tag, 'data-ui')
    const parts = [...new Set([...namespaceTokenValues(existing, 'part'), dataSlotPart])].filter(
      (part): part is string => Boolean(part)
    )
    const authoredDataUi = mergePartsDataUi(existing, parts)
    const explicitSemantic = existing?.split(/\s+/).find((token) => token && !token.includes(':'))
    const semanticId =
      explicitSemantic ??
      (tag.name === 'body'
        ? 'app.window'
        : inferSemanticId({
            component: options.windowName,
            element: tag.name,
            htmlId: htmlAttribute(tag, 'id'),
            isComponentRoot: isBoundaryRoot,
            name: htmlAttribute(tag, 'name'),
            part: parts[0],
            role: htmlAttribute(tag, 'role'),
            sourceFile: options.sourceFile,
            testId: htmlAttribute(tag, 'data-testid'),
            type: htmlAttribute(tag, 'type')
          }))
    const descriptor: UiNodeDescriptor = {
      component: options.windowName,
      element: tag.name,
      kind: 'html',
      semanticId,
      semanticSource: explicitSemantic ? 'explicit' : 'inferred',
      sourceFile: options.sourceFile,
      sourceOffset: tag.start
    }
    descriptors.push(descriptor)

    if (!options.injectDataUi) continue
    const value = mergeDataUi(authoredDataUi, descriptor.semanticId)
    if (existing !== undefined) {
      const attribute = tag.source.match(/\sdata-ui\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i)
      if (attribute?.index !== undefined) {
        const start = tag.start + attribute.index
        magicString.overwrite(start, start + attribute[0].length, ` data-ui=${JSON.stringify(value)}`)
      }
    } else {
      let insertAt = tag.source.endsWith('/>') ? tag.end - 2 : tag.end - 1
      while (/\s/.test(source[insertAt - 1])) insertAt -= 1
      magicString.appendLeft(insertAt, ` data-ui=${JSON.stringify(value)}`)
    }
  }

  return {
    code: options.injectDataUi ? magicString.toString() : source,
    descriptors,
    map: null
  }
}
