import { type JSXAttribute, type JSXElementName, type JSXOpeningElement, parseSync, type Span } from '@swc/core'
import { Parser } from 'htmlparser2'
import MagicString from 'magic-string'

import { createDescriptorHashes, identifierWords, inferSemanticId } from './semanticId'
import type { UiNodeDescriptor, UiSourceTransform } from './types'

const SKIPPED_COMPONENTS = new Set(['Consumer', 'Fragment', 'Provider', 'StrictMode', 'Suspense'])
const SKIPPED_HTML_TAGS = new Set(['base', 'head', 'html', 'link', 'meta', 'script', 'style', 'title'])
const SEMANTIC_ATTRIBUTES = new Set(['data-slot', 'data-testid', 'id', 'name', 'role', 'type'])
const SVG_OPT_IN_ATTRIBUTES = ['data-slot', 'data-testid', 'role']

type AstRecord = Record<string, unknown> & { span?: Span; type?: string }

interface AttributeInfo {
  attribute?: JSXAttribute
  dynamic: boolean
  value?: string
}

interface OpeningElementInfo {
  attributes: Map<string, AttributeInfo>
  element: string
  handler?: string
  signature: string
}

function hasSvgContractOptIn(info: OpeningElementInfo): boolean {
  return (
    info.attributes.has('data-ui') ||
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

function openingElementInfo(opening: JSXOpeningElement): OpeningElementInfo {
  const attributes = new Map<string, AttributeInfo>()
  let handler: string | undefined

  for (const attribute of opening.attributes) {
    if (attribute.type !== 'JSXAttribute' || attribute.name.type !== 'Identifier') continue
    const name = attribute.name.value
    const info = staticJsxAttribute(attribute)
    attributes.set(name, info)
    if (/^on[A-Z]/.test(name) && attribute.value?.type === 'JSXExpressionContainer') {
      handler = expressionIdentifier(attribute.value.expression) ?? name
    }
  }

  const element = jsxName(opening.name)
  const semanticSignature = [...attributes.entries()]
    .filter(([name, info]) => SEMANTIC_ATTRIBUTES.has(name) && !info.dynamic)
    .map(([name, info]) => `${name}=${info.value}`)
    .sort()
  const handlerNames = [...attributes.keys()].filter((name) => /^on[A-Z]/.test(name)).sort()

  return {
    attributes,
    element,
    handler,
    signature: [...semanticSignature, ...handlerNames].join('|')
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

function attributeReplacement(
  source: string,
  attribute: JSXAttribute,
  value: string,
  spanToCharacter: (value: number) => number
) {
  const start = spanToCharacter(attribute.span.start)
  const end = spanToCharacter(attribute.span.end)
  const original = source.slice(start, end)
  const leading = original.match(/^\s*/)?.[0] ?? ''
  return { end, start, value: `${leading}data-ui=${JSON.stringify(value)}` }
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
  const tokens = new Set((existing ?? '').split(/\s+/).filter(Boolean))
  tokens.add(semanticId)
  tokens.add(`id:${id}`)
  return [...tokens].join(' ')
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
  const spanToCharacter = (value: number) => byteToCharacter(value - module.span.start)
  const descriptors: UiNodeDescriptor[] = []
  const occurrenceByAnchor = new Map<string, number>()

  function processOpening(
    opening: JSXOpeningElement,
    component: string,
    parentSemanticId: string | undefined,
    insideSvg: boolean
  ): string | undefined {
    const info = openingElementInfo(opening)
    const elementLeaf = info.element.split('.').at(-1) ?? info.element
    if (SKIPPED_COMPONENTS.has(elementLeaf)) return parentSemanticId

    const existingDataUi = info.attributes.get('data-ui')
    const isIntrinsicElement = /^[a-z]/.test(info.element)
    const forwardsDomAttributes = ['data-slot', 'data-testid', 'id', 'role'].some((name) => info.attributes.has(name))
    if (!isIntrinsicElement && !existingDataUi && !forwardsDomAttributes) return parentSemanticId
    if (insideSvg && info.element !== 'svg' && !hasSvgContractOptIn(info)) return parentSemanticId
    const dynamicSemanticId = dynamicUiSemanticId(existingDataUi)
    if (existingDataUi?.dynamic && !dynamicSemanticId) return parentSemanticId

    const explicitId = explicitSemanticId(existingDataUi) ?? dynamicSemanticId
    const semanticId =
      explicitId ??
      inferSemanticId({
        component,
        element: info.element,
        handler: info.handler,
        htmlId: info.attributes.get('id')?.value,
        name: info.attributes.get('name')?.value,
        slot: info.attributes.get('data-slot')?.value,
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
    const value = mergeDataUi(existingDataUi?.value, contract.semanticId, contract.id)
    if (
      existingDataUi?.dynamic &&
      existingDataUi.attribute?.value?.type === 'JSXExpressionContainer' &&
      existingDataUi.attribute.value.expression.type === 'CallExpression'
    ) {
      const expression = existingDataUi.attribute.value.expression
      const expressionSource = source.slice(
        spanToCharacter(expression.span.start),
        spanToCharacter(expression.span.end)
      )
      const replacement = attributeReplacement(source, existingDataUi.attribute, value, spanToCharacter)
      replacement.value = `data-ui={[${expressionSource}, ${JSON.stringify(`id:${contract.id}`)}].filter(Boolean).join(' ')}`
      magicString.overwrite(replacement.start, replacement.end, replacement.value)
    } else if (existingDataUi?.attribute) {
      const replacement = attributeReplacement(source, existingDataUi.attribute, value, spanToCharacter)
      magicString.overwrite(replacement.start, replacement.end, replacement.value)
    } else {
      magicString.appendLeft(spanToCharacter(opening.span.end) - 1, ` data-ui=${JSON.stringify(value)}`)
    }
    return semanticId
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
  insideSvg: boolean
  name: string
  source: string
  start: number
}

function htmlTags(source: string): HtmlTagMatch[] {
  const tags: HtmlTagMatch[] = []
  const svgContext: boolean[] = []
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        const insideSvg = svgContext.at(-1) ?? false
        svgContext.push(name === 'foreignobject' ? false : insideSvg || name === 'svg')
        if (SKIPPED_HTML_TAGS.has(name)) return
        const start = parser.startIndex
        const end = parser.endIndex + 1
        tags.push({ attributes, end, insideSvg, name, source: source.slice(start, end), start })
      },
      onclosetag() {
        svgContext.pop()
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
  let parentSemanticId: string | undefined

  for (const tag of htmlTags(source)) {
    if (tag.insideSvg && tag.name !== 'svg' && !hasHtmlSvgContractOptIn(tag)) continue
    const existing = htmlAttribute(tag, 'data-ui')
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
            sourceFile: options.sourceFile,
            testId: htmlAttribute(tag, 'data-testid'),
            type: htmlAttribute(tag, 'type')
          }))
    const signature = ['id', 'name', 'role', 'type']
      .map((name) => [name, htmlAttribute(tag, name)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
      .map(([name, value]) => `${name}=${value}`)
      .join('|')
    const occurrenceKey = `${semanticId}\0${tag.name}\0${signature}`
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
    parentSemanticId = semanticId

    const contract = options.contractForDescriptor?.(descriptor)
    if (!contract) continue
    const rootTokens =
      tag.name === 'body'
        ? ` scope:window:${identifierWords(options.windowName).join('-')} boundary:app theme:custom`
        : ''
    const value = `${mergeDataUi(existing, contract.semanticId, contract.id)}${rootTokens}`
    if (existing !== undefined) {
      const attribute = tag.source.match(/\sdata-ui\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i)
      if (attribute?.index !== undefined) {
        const start = tag.start + attribute.index
        magicString.overwrite(start, start + attribute[0].length, ` data-ui=${JSON.stringify(value)}`)
      }
    } else {
      const insertAt = tag.source.endsWith('/>') ? tag.end - 2 : tag.end - 1
      magicString.appendLeft(insertAt, ` data-ui=${JSON.stringify(value)}`)
    }
  }

  return {
    code: options.contractForDescriptor ? magicString.toString() : source,
    descriptors,
    map: null
  }
}
