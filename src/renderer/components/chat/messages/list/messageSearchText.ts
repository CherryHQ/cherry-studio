import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { processLatexBrackets } from '@renderer/utils/markdown'
import { DomUtils, parseDocument } from 'htmlparser2'
import type { Nodes } from 'mdast'
import remarkGithubBlockquoteAlert from 'remark-github-blockquote-alert'
import remarkParse from 'remark-parse'
import { defaultRemarkPlugins } from 'streamdown'
import type { Pluggable } from 'unified'
import { unified } from 'unified'

const CITATION_MARKER_PATTERN = /\[cite:[^\]]+\]/giu
const CITATION_SUP_OPEN_PATTERN = /<sup\b[^>]*\bdata-citation(?:\s*=|\s|>)/iu
const CITATION_SUP_CLOSE_PATTERN = /<\/sup\s*>/iu

export const MESSAGE_SEARCH_EXCLUDED_ELEMENT_SELECTOR =
  'button,[role="button"],[data-citation],[data-message-search-exclude],[aria-hidden="true"],[data-streamdown="code-block-header"],.code-block-header,.code-toolbar,script,style'

const markdownProcessor = unified()
  .use(remarkParse)
  .use([...Object.values(defaultRemarkPlugins), remarkGithubBlockquoteAlert] as Pluggable[])

function projectHtmlText(source: string): string {
  const document = parseDocument(source)
  const excludedElements = DomUtils.findAll((element) => {
    const classNames = new Set((element.attribs.class ?? '').split(/\s+/u))
    return (
      element.name === 'button' ||
      element.name === 'iframe' ||
      element.name === 'script' ||
      element.name === 'style' ||
      element.attribs.role === 'button' ||
      element.attribs['data-citation'] !== undefined ||
      element.attribs['data-message-search-exclude'] !== undefined ||
      element.attribs['aria-hidden'] === 'true' ||
      element.attribs['data-streamdown'] === 'code-block-header' ||
      classNames.has('code-block-header') ||
      classNames.has('code-toolbar')
    )
  }, document.children)
  for (const element of excludedElements) {
    DomUtils.removeElement(element)
  }
  return DomUtils.textContent(document)
}

function hasChildren(node: Nodes): node is Nodes & { children: Nodes[] } {
  return 'children' in node
}

function projectChildren(children: readonly Nodes[]): string {
  let insideCitation = false
  let text = ''

  for (const child of children) {
    if (child.type === 'html') {
      const opensCitation = CITATION_SUP_OPEN_PATTERN.test(child.value)
      const closesCitation = CITATION_SUP_CLOSE_PATTERN.test(child.value)
      if (opensCitation && !closesCitation) insideCitation = true
      if (!insideCitation || (opensCitation && closesCitation)) text += projectHtmlText(child.value)
      if (closesCitation) insideCitation = false
      continue
    }
    if (!insideCitation) text += projectMarkdownNode(child)
  }

  return text
}

function projectMarkdownNode(node: Nodes): string {
  switch (node.type) {
    case 'text':
      return node.value.replace(CITATION_MARKER_PATTERN, '')
    case 'code':
    case 'inlineCode':
      return node.value
    case 'footnoteReference':
      return node.label ?? node.identifier
    case 'html':
      return projectHtmlText(node.value)
    case 'definition':
    case 'image':
    case 'imageReference':
    case 'break':
    case 'thematicBreak':
      return ''
    default:
      return hasChildren(node) ? projectChildren(node.children) : ''
  }
}

/** Project Markdown through the same base remark syntax plugins used by ChatMarkdown. */
export function projectMarkdownSearchText(source: string): string {
  const normalized = removeSvgEmptyLines(processLatexBrackets(source))
  const tree = markdownProcessor.runSync(markdownProcessor.parse(normalized)) as Nodes
  return projectMarkdownNode(tree)
}
