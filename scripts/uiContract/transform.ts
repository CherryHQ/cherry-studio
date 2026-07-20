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

import { createDescriptorHashes, identifierWords, inferSemanticId } from './semanticId'
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
// These virtual parents preserve descendant IDs after non-DOM wrappers were removed from the public registry.
const TRANSPARENT_PARENT_PARTS = new Map([
  ['DialogPortal', 'dialog-portal'],
  ['DrawerPortal', 'drawer-portal']
])
const SEMANTIC_ATTRIBUTES = new Set(['data-testid', 'id', 'name', 'role', 'type'])
const SVG_OPT_IN_ATTRIBUTES = ['data-testid', 'role']
const UI_PACKAGE_SOURCE_PREFIX = 'packages/ui/src/'
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
  dataSlotPart?: string
  element: string
  handler?: string
  parts: string[]
  signature: string
  spreads: SpreadElement[]
}

function hasSvgContractOptIn(info: OpeningElementInfo): boolean {
  return (
    info.attributes.has('data-ui') ||
    info.dataSlotPart !== undefined ||
    SVG_OPT_IN_ATTRIBUTES.some((name) => info.attributes.has(name)) ||
    [...info.attributes.keys()].some((name) => /^on[A-Z]/.test(name))
  )
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

// This spelling is hash compatibility only. It is never written to source or emitted to the DOM.
function stablePartSignature(part: string): string {
  return `data-slot=${part}`
}

function uiPackageDataSlot(attributes: Map<string, AttributeInfo>, sourceFile: string): string | undefined {
  const dataSlot = attributes.get('data-slot')
  if (!dataSlot) return undefined
  if (!sourceFile.startsWith(UI_PACKAGE_SOURCE_PREFIX)) {
    throw new Error('data-slot is reserved for packages/ui/src; use a part:* token inside data-ui')
  }
  if (dataSlot.dynamic || !dataSlot.value || !DATA_SLOT_VALUE.test(dataSlot.value)) {
    throw new Error('packages/ui data-slot must be a static token')
  }
  return dataSlot.value
}

function openingElementInfo(opening: JSXOpeningElement, sourceFile: string): OpeningElementInfo {
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
      handler = expressionIdentifier(attribute.value.expression) ?? name
    }
  }

  const element = jsxName(opening.name)
  const dataSlotPart = uiPackageDataSlot(attributes, sourceFile)
  const parts = [...new Set([...namespaceTokenValues(attributes.get('data-ui')?.value, 'part'), dataSlotPart])].filter(
    (part): part is string => Boolean(part)
  )
  const semanticSignature = [...attributes.entries()]
    .filter(([name, info]) => SEMANTIC_ATTRIBUTES.has(name) && !info.dynamic)
    .map(([name, info]) => `${name}=${info.value}`)
    .sort()
  const handlerNames = [...attributes.keys()].filter((name) => /^on[A-Z]/.test(name)).sort()

  return {
    attributes,
    dataSlotPart,
    element,
    handler,
    parts,
    signature: [...semanticSignature, ...parts.map(stablePartSignature)].sort().concat(handlerNames).join('|'),
    spreads
  }
}

function explicitSemanticId(dataUi: AttributeInfo | undefined): string | undefined {
  if (!dataUi?.value || dataUi.dynamic) return undefined
  return dataUi.value.split(/\s+/).find((token) => token && !token.includes(':') && !token.startsWith('id:'))
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

function mergeDataUi(existing: string | undefined, semanticId: string, id: string): string {
  const existingTokens = (existing ?? '').split(/\s+/).filter(Boolean)
  const semanticTokens = existingTokens.filter((token) => !token.includes(':'))
  const partTokens = existingTokens.filter((token) => token.startsWith('part:'))
  const remainingTokens = existingTokens.filter(
    (token) => token.includes(':') && !token.startsWith('id:') && !token.startsWith('part:')
  )
  return [...new Set([semanticId, ...semanticTokens, ...partTokens, `id:${id}`, ...remainingTokens])].join(' ')
}

function mergePartDataUi(existing: string | undefined, part: string | undefined): string | undefined {
  if (!part) return existing
  const existingTokens = (existing ?? '').split(/\s+/).filter(Boolean)
  const semanticTokens = existingTokens.filter((token) => !token.includes(':'))
  const partTokens = [...existingTokens.filter((token) => token.startsWith('part:')), `part:${part}`]
  const exactIdTokens = existingTokens.filter((token) => token.startsWith('id:'))
  const remainingTokens = existingTokens.filter(
    (token) => token.includes(':') && !token.startsWith('id:') && !token.startsWith('part:')
  )
  return [...new Set([...semanticTokens, ...partTokens, ...exactIdTokens, ...remainingTokens])].join(' ')
}

interface TransformJsxOptions {
  contractForDescriptor?: (descriptor: UiNodeDescriptor) => { id: string; semanticId: string } | undefined
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
  const occurrenceByAnchor = new Map<string, number>()
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
    parentSemanticId: string | undefined,
    insideSvg: boolean
  ): string | undefined {
    const info = openingElementInfo(opening, options.sourceFile)
    const elementLeaf = info.element.split('.').at(-1) ?? info.element
    if (SKIPPED_COMPONENTS.has(elementLeaf)) return parentSemanticId
    if (NON_DOM_COMPONENTS.has(info.element)) {
      const parentPart = TRANSPARENT_PARENT_PARTS.get(info.element)
      return parentPart
        ? inferSemanticId({ component, element: info.element, part: parentPart, sourceFile: options.sourceFile })
        : parentSemanticId
    }
    if (SKIPPED_HTML_TAGS.has(info.element)) return parentSemanticId

    const existingDataUi = info.attributes.get('data-ui')
    const isIntrinsicElement = /^[a-z]/.test(info.element)
    if (!isIntrinsicElement) {
      const staticDataUi = existingDataUi?.dynamic ? undefined : existingDataUi?.value
      const forwardedDataUi = mergePartDataUi(staticDataUi, info.dataSlotPart)
      if (
        options.contractForDescriptor &&
        forwardedDataUi &&
        (info.dataSlotPart !== undefined ||
          (existingDataUi?.value && !existingDataUi.dynamic && info.spreads.length > 0))
      ) {
        injectDataUi(opening, existingDataUi, forwardedDataUi)
      }
      return parentSemanticId
    }
    if (insideSvg && info.element !== 'svg' && !hasSvgContractOptIn(info)) return parentSemanticId
    const dynamicSemanticId = dynamicUiSemanticId(existingDataUi)

    const explicitId = explicitSemanticId(existingDataUi) ?? dynamicSemanticId
    const semanticId =
      explicitId ??
      inferSemanticId({
        component,
        element: info.element,
        handler: info.handler,
        htmlId: info.attributes.get('id')?.value,
        name: info.attributes.get('name')?.value,
        part: info.parts[0],
        sourceFile: options.sourceFile,
        testId: info.attributes.get('data-testid')?.value,
        type: info.attributes.get('type')?.value
      })
    const occurrenceKey = [component, semanticId, info.element, info.signature, parentSemanticId ?? ''].join('\0')
    const occurrence = occurrenceByAnchor.get(occurrenceKey) ?? 0
    occurrenceByAnchor.set(occurrenceKey, occurrence + 1)
    const hashes = createDescriptorHashes({
      component,
      element: info.element,
      occurrence,
      parentSemanticId,
      semanticId,
      signature: info.signature,
      sourceFile: options.sourceFile
    })
    const descriptor: UiNodeDescriptor = {
      ...hashes,
      component,
      element: info.element,
      kind: 'jsx',
      semanticId,
      semanticSource: explicitId ? 'explicit' : 'inferred',
      sourceFile: options.sourceFile,
      sourceOffset: spanToCharacter(opening.span.start)
    }
    descriptors.push(descriptor)

    const contract = options.contractForDescriptor?.(descriptor)
    if (!contract) return semanticId
    const staticDataUi = existingDataUi?.dynamic ? undefined : existingDataUi?.value
    const authoredDataUi = mergePartDataUi(staticDataUi, info.dataSlotPart)
    injectDataUi(opening, existingDataUi, mergeDataUi(authoredDataUi, contract.semanticId, contract.id))
    return semanticId
  }

  function hasAsChildAttribute(opening: JSXOpeningElement): boolean {
    return opening.attributes.some(
      (attribute) =>
        attribute.type === 'JSXAttribute' && attribute.name.type === 'Identifier' && attribute.name.value === 'asChild'
    )
  }

  function walk(value: unknown, component: string, parentSemanticId?: string, insideSvg = false): void {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, component, parentSemanticId, insideSvg)
      return
    }
    if (!isRecord(value)) return

    const nestedComponent = componentNameFromNode(value) ?? component
    if (value.type === 'JSXElement' && isRecord(value.opening) && value.opening.type === 'JSXOpeningElement') {
      const opening = value.opening as unknown as JSXOpeningElement
      const element = jsxName(opening.name)
      const semanticId = processOpening(opening, nestedComponent, parentSemanticId, insideSvg)
      const childrenInsideSvg = element === 'foreignObject' ? false : insideSvg || element === 'svg'
      if (
        options.contractForDescriptor &&
        !/^[a-z]/.test(element) &&
        hasAsChildAttribute(opening) &&
        Array.isArray(value.children) &&
        value.children.length > 0 &&
        isRecord(value.closing) &&
        value.closing.span
      ) {
        magicString.appendLeft(spanToCharacter(opening.span.end), `<${RUNTIME_SLOT}>`)
        magicString.appendLeft(spanToCharacter(value.closing.span.start), `</${RUNTIME_SLOT}>`)
        runtimeImports.add('UiDataSlot')
      }
      if (Array.isArray(value.children)) walk(value.children, nestedComponent, semanticId, childrenInsideSvg)
      for (const attribute of opening.attributes) {
        if (attribute.type === 'JSXAttribute' && attribute.value?.type === 'JSXExpressionContainer') {
          walk(attribute.value.expression, nestedComponent, semanticId, childrenInsideSvg)
        }
      }
      return
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === 'span' || key === 'ctxt' || key === 'type') continue
      walk(child, nestedComponent, parentSemanticId, insideSvg)
    }
  }

  walk(module, defaultComponentName(options.sourceFile))

  if (options.contractForDescriptor && runtimeImports.size > 0) {
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
    code: options.contractForDescriptor ? magicString.toString() : source,
    descriptors,
    map: options.contractForDescriptor
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

function hasHtmlSvgContractOptIn(tag: HtmlTagMatch): boolean {
  return (
    htmlAttribute(tag, 'data-ui') !== undefined ||
    SVG_OPT_IN_ATTRIBUTES.some((name) => htmlAttribute(tag, name) !== undefined) ||
    Object.keys(tag.attributes).some((name) => name.startsWith('on'))
  )
}

interface TransformHtmlOptions extends TransformJsxOptions {
  windowName: string
}

export function transformHtml(source: string, options: TransformHtmlOptions): UiSourceTransform {
  const magicString = new MagicString(source)
  const descriptors: UiNodeDescriptor[] = []
  const occurrences = new Map<string, number>()
  const tags = htmlTags(source)
  const semanticByTagIndex = new Map<number, string>()

  for (const tag of tags) {
    if (SKIPPED_HTML_TAGS.has(tag.name)) continue
    if (htmlAttribute(tag, 'data-slot') !== undefined) {
      throw new Error('data-slot is reserved for packages/ui/src; use a part:* token inside data-ui')
    }
    if (tag.insideSvg && tag.name !== 'svg' && !hasHtmlSvgContractOptIn(tag)) continue
    let parentIndex = tag.parentIndex
    let parentSemanticId: string | undefined
    while (parentIndex !== undefined && parentSemanticId === undefined) {
      parentSemanticId = semanticByTagIndex.get(parentIndex)
      parentIndex = tags[parentIndex]?.parentIndex
    }
    const existing = htmlAttribute(tag, 'data-ui')
    const parts = namespaceTokenValues(existing, 'part')
    const explicitId = existing?.split(/\s+/).find((token) => token && !token.includes(':') && !token.startsWith('id:'))
    const semanticId =
      explicitId ??
      (tag.name === 'body'
        ? 'app.window'
        : inferSemanticId({
            component: options.windowName,
            element: tag.name,
            htmlId: htmlAttribute(tag, 'id'),
            name: htmlAttribute(tag, 'name'),
            part: parts[0],
            sourceFile: options.sourceFile,
            testId: htmlAttribute(tag, 'data-testid'),
            type: htmlAttribute(tag, 'type')
          }))
    const signature = [
      ...['id', 'name', 'role', 'type']
        .map((name) => [name, htmlAttribute(tag, name)] as const)
        .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
        .map(([name, value]) => `${name}=${value}`),
      ...parts.map(stablePartSignature)
    ].join('|')
    const occurrenceKey = `${semanticId}\0${tag.name}\0${signature}\0${parentSemanticId ?? ''}`
    const occurrence = occurrences.get(occurrenceKey) ?? 0
    occurrences.set(occurrenceKey, occurrence + 1)
    const hashes = createDescriptorHashes({
      component: options.windowName,
      element: tag.name,
      occurrence,
      parentSemanticId,
      semanticId,
      signature,
      sourceFile: options.sourceFile
    })
    const descriptor: UiNodeDescriptor = {
      ...hashes,
      component: options.windowName,
      element: tag.name,
      kind: 'html',
      semanticId,
      semanticSource: explicitId ? 'explicit' : 'inferred',
      sourceFile: options.sourceFile,
      sourceOffset: tag.start
    }
    descriptors.push(descriptor)
    semanticByTagIndex.set(tag.index, semanticId)

    const contract = options.contractForDescriptor?.(descriptor)
    if (!contract) continue
    const rootTokens = tag.name === 'body' ? ` scope:window:${identifierWords(options.windowName).join('-')}` : ''
    const value = `${mergeDataUi(existing, contract.semanticId, contract.id)}${rootTokens}`
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
    code: options.contractForDescriptor ? magicString.toString() : source,
    descriptors,
    map: null
  }
}
