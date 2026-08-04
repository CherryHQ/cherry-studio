import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { processLatexBrackets } from '@renderer/utils/markdown'
import { Parser } from 'htmlparser2'
import type { Nodes } from 'mdast'
import remarkGithubBlockquoteAlert from 'remark-github-blockquote-alert'
import remarkParse from 'remark-parse'
import { defaultRemarkPlugins } from 'streamdown'
import type { Pluggable } from 'unified'
import { unified } from 'unified'

const CITATION_MARKER_PATTERN = /\[cite:[^\]]+\]/giu

export const MESSAGE_SEARCH_EXCLUDED_ELEMENT_SELECTOR =
  'button,[role="button"],[data-citation],[data-message-search-exclude],[aria-hidden="true"],[data-streamdown="code-block-header"],.code-block-header,.code-toolbar,script,style'

const markdownProcessor = unified()
  .use(remarkParse)
  .use([...Object.values(defaultRemarkPlugins), remarkGithubBlockquoteAlert] as Pluggable[])

function isExcludedHtmlElement(name: string, attributes: Record<string, string>): boolean {
  const classNames = new Set((attributes.class ?? '').split(/\s+/u))
  return (
    name === 'button' ||
    name === 'iframe' ||
    name === 'script' ||
    name === 'style' ||
    attributes.role === 'button' ||
    attributes['data-citation'] !== undefined ||
    attributes['data-message-search-exclude'] !== undefined ||
    attributes['aria-hidden'] === 'true' ||
    attributes['data-streamdown'] === 'code-block-header' ||
    classNames.has('code-block-header') ||
    classNames.has('code-toolbar')
  )
}

function hasChildren(node: Nodes): node is Nodes & { children: Nodes[] } {
  return 'children' in node
}

interface ProjectionContext {
  appendText: (text: string) => void
  getText: () => string
  htmlParser: Parser
}

function createProjectionContext(): ProjectionContext {
  const excludedElements: boolean[] = []
  let projectedText = ''
  const appendText = (text: string) => {
    if (!excludedElements.includes(true)) projectedText += text
  }
  const htmlParser = new Parser(
    {
      onopentag(name, attributes) {
        excludedElements.push(isExcludedHtmlElement(name, attributes))
      },
      ontext: appendText,
      onclosetag() {
        excludedElements.pop()
      }
    },
    { decodeEntities: true }
  )
  return { appendText, getText: () => projectedText, htmlParser }
}

function projectChildren(children: readonly Nodes[], context: ProjectionContext): void {
  for (const child of children) {
    projectMarkdownNode(child, context)
  }
}

function projectMarkdownNode(node: Nodes, context: ProjectionContext): void {
  switch (node.type) {
    case 'text':
      context.appendText(node.value.replace(CITATION_MARKER_PATTERN, ''))
      return
    case 'code':
    case 'inlineCode':
      context.appendText(node.value)
      return
    case 'footnoteReference':
      context.appendText(node.label ?? node.identifier)
      return
    case 'html':
      context.htmlParser.write(node.value)
      return
    case 'definition':
    case 'image':
    case 'imageReference':
    case 'break':
    case 'thematicBreak':
      return
    default:
      if (hasChildren(node)) projectChildren(node.children, context)
  }
}

/** Project Markdown through the same base remark syntax plugins used by ChatMarkdown. */
export function projectMarkdownSearchText(source: string): string {
  const normalized = removeSvgEmptyLines(processLatexBrackets(source))
  const tree = markdownProcessor.runSync(markdownProcessor.parse(normalized)) as Nodes
  const context = createProjectionContext()
  projectMarkdownNode(tree, context)
  context.htmlParser.end()
  return context.getText()
}
