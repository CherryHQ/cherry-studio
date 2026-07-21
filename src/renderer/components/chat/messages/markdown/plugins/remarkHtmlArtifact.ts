import type { Code, Html, Root } from 'mdast'
import type { Plugin } from 'unified'

const LEADING_HTML_METADATA_REGEX = /^(?:\s*(?:<!--[\s\S]*?-->|<!doctype[^>]*>|<\?[\s\S]*?\?>))*/i

function isHtmlArtifact(node: Html): boolean {
  const content = node.value.replace(LEADING_HTML_METADATA_REGEX, '').trimStart()
  return content.length > 0 && !/^<svg[\s>]/i.test(content)
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
  tree.children = tree.children.map((child) =>
    child.type === 'html' && isHtmlArtifact(child) ? createHtmlCodeNode(child) : child
  )
}
