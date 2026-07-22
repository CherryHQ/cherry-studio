import type { Code, Html, Root, RootContent } from 'mdast'
import type { Plugin } from 'unified'

const LEADING_HTML_METADATA_REGEX = /^(?:\s*(?:<!--[\s\S]*?-->|<!doctype[^>]*>|<\?[\s\S]*?\?>))*/i
const HTML_DOCUMENT_START_REGEX = /^<html(?:\s|>)/i
const HTML_DOCUMENT_END_REGEX = /<\/html\s*>/i

function stripLeadingHtmlMetadata(value: string): string {
  return value.replace(LEADING_HTML_METADATA_REGEX, '').trimStart()
}

function isHtmlArtifact(node: Html): boolean {
  const content = stripLeadingHtmlMetadata(node.value)
  return content.length > 0 && !/^<svg[\s>]/i.test(content)
}

function isHtmlMetadataOnly(node: Html): boolean {
  return stripLeadingHtmlMetadata(node.value).length === 0
}

function findHtmlDocumentEnd(children: readonly RootContent[], startIndex: number): number | undefined {
  let documentStartIndex = startIndex

  while (true) {
    const child = children[documentStartIndex]
    if (child?.type !== 'html' || !isHtmlMetadataOnly(child)) break
    documentStartIndex += 1
  }

  const documentStart = children[documentStartIndex]
  if (
    documentStart?.type !== 'html' ||
    !HTML_DOCUMENT_START_REGEX.test(stripLeadingHtmlMetadata(documentStart.value))
  ) {
    return undefined
  }

  for (let index = documentStartIndex; index < children.length; index += 1) {
    const child = children[index]
    if (!child || child.type !== 'html') return undefined
    if (HTML_DOCUMENT_END_REGEX.test(child.value)) return index
  }

  return undefined
}

type HtmlDocumentNodes = readonly [Html, ...Html[]]

function joinHtmlDocumentNodes(nodes: HtmlDocumentNodes): string {
  return nodes.reduce((content, node, index) => {
    if (index === 0) return node.value

    const previousEndLine = nodes[index - 1]?.position?.end.line
    const nextStartLine = node.position?.start.line
    const separator =
      previousEndLine !== undefined && nextStartLine !== undefined
        ? '\n'.repeat(Math.max(0, nextStartLine - previousEndLine))
        : '\n'

    return `${content}${separator}${node.value}`
  }, '')
}

function createHtmlDocumentCodeNode(nodes: HtmlDocumentNodes): Code {
  const first = nodes[0]
  const last = nodes[nodes.length - 1] ?? first
  const position =
    first.position && last.position ? { start: first.position.start, end: last.position.end } : first.position

  return {
    type: 'code',
    lang: 'html',
    value: joinHtmlDocumentNodes(nodes),
    position
  }
}

function createHtmlCodeNode(node: Html): Code {
  return {
    type: 'code',
    lang: 'html',
    value: node.value,
    position: node.position
  }
}

/**
 * Routes top-level raw HTML regions through the same renderer as fenced HTML.
 * Inline HTML stays in the Markdown tree so citations and text formatting keep
 * their existing behavior.
 */
export const remarkHtmlArtifact: Plugin<[], Root> = () => (tree) => {
  const children: RootContent[] = []

  for (let index = 0; index < tree.children.length; index += 1) {
    const documentEndIndex = findHtmlDocumentEnd(tree.children, index)
    if (documentEndIndex !== undefined) {
      children.push(createHtmlDocumentCodeNode(tree.children.slice(index, documentEndIndex + 1) as [Html, ...Html[]]))
      index = documentEndIndex
      continue
    }

    const child = tree.children[index]
    if (!child) continue
    children.push(child.type === 'html' && isHtmlArtifact(child) ? createHtmlCodeNode(child) : child)
  }

  tree.children = children
}
