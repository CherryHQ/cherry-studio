import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { CONTINUE, EXIT, visit } from 'unist-util-visit'

import { KNOWLEDGE_URL_CRAWL_MAX_ITEMS } from '@shared/data/types/knowledge'

export function collectKnowledgeUrlLinks(markdown: string, source: string): string[] {
  const root = new URL(source)
  root.hash = ''
  if (!['http:', 'https:'].includes(root.protocol)) return []
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown)
  const definitions = new Map<string, string>()
  visit(tree, 'definition', (node) => {
    if (!definitions.has(node.identifier)) definitions.set(node.identifier, node.url)
  })
  const seen = new Set([root.href])
  const urls: string[] = []
  visit(tree, (node) => {
    const href =
      node.type === 'link' ? node.url : node.type === 'linkReference' ? definitions.get(node.identifier) : undefined
    if (!href || href.startsWith('#')) return CONTINUE
    let url: URL
    try {
      url = new URL(href, root)
    } catch {
      return CONTINUE
    }
    url.hash = ''
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== root.origin ||
      url.username ||
      url.password ||
      seen.has(url.href)
    )
      return CONTINUE
    seen.add(url.href)
    urls.push(url.href)
    return urls.length === KNOWLEDGE_URL_CRAWL_MAX_ITEMS - 1 ? EXIT : CONTINUE
  })
  return urls
}
