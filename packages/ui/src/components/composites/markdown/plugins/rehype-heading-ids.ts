import type { Element, Node, Root, Text } from 'hast'
import { visit } from 'unist-util-visit'

/**
 * 基于 GitHub 风格的标题 slug 生成器（去重逻辑）
 * - 小写
 * - 去除前后空白
 * - 移除部分标点
 * - 将空白与非字母数字字符合并为单个 '-'
 * - 多次出现的相同 slug 加上递增后缀（-1, -2...）
 */
export interface HeadingSlugger {
  slug: (text: string) => string
}

export interface RehypeHeadingIdsOptions {
  prefix?: string
  /**
   * Heading slugs already assigned at the document level, keyed by normalized heading text and
   * listed in document order. A windowed preview passes each piece its own headings' slugs so
   * duplicates keep the ids the unsplit document would give them.
   */
  slugs?: ReadonlyMap<string, readonly string[]>
}

/** The slug form of a heading's text — the key shared assignments are looked up by. */
export function normalizeHeadingText(text: string): string {
  return (
    (text || 'section')
      .toLowerCase()
      .trim()
      // 移除常见分隔符和标点
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // 零宽字符
      .replace(/["'`(){}[\]:;!?.,]/g, '')
      // 将空白和非字母数字字符转换为 '-'
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      // 合并多余的 '-'
      .replace(/-{2,}/g, '-')
      // 去除首尾 '-'
      .replace(/^-|-$/g, '') || 'section'
  )
}

export function createSlugger(): HeadingSlugger {
  const seen = new Map<string, number>()

  const slug = (text: string): string => {
    const base = normalizeHeadingText(text)
    const count = seen.get(base) || 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base}-${count}`
  }

  return { slug }
}

export function extractTextFromNode(node: Node | Text | Element | null | undefined): string {
  if (!node) return ''

  if (typeof (node as Text).value === 'string') {
    return (node as Text).value
  }

  if ((node as Element).children?.length) {
    return (node as Element).children.map(extractTextFromNode).join('')
  }

  return ''
}

export default function rehypeHeadingIds(options?: RehypeHeadingIdsOptions): (tree: Root) => void {
  return (tree: Root): void => {
    const prefix = options?.prefix ? `${options.prefix}--` : ''
    // Assignments are consumed in order, so each run copies its own — a re-parse of the same
    // source starts from the same slugs instead of an emptied map.
    const assigned = options?.slugs && new Map(Array.from(options.slugs, ([key, slugs]) => [key, [...slugs]]))
    // Every id the document's own numbering has given out, the assignments this run will hand back
    // included: a heading the scan never saw falls to the counter below, and one of those ids
    // falling out of it a second time would put two elements under one id.
    const taken = options?.slugs && new Set<string>(Array.from(options.slugs, ([, slugs]) => slugs).flat())
    const seen = new Map<string, number>()
    const fallback = (text: string): string => {
      const base = normalizeHeadingText(text)
      let count = seen.get(base) ?? 0
      let id = count === 0 ? base : `${base}-${count}`
      count += 1
      if (taken?.has(id)) {
        while (taken.has(`${base}-${count}`)) count += 1
        id = `${base}-${count}`
        count += 1
      }
      seen.set(base, count)
      taken?.add(id)
      return id
    }
    visit(tree, 'element', (node) => {
      if (!node || typeof node.tagName !== 'string') return
      const tag = node.tagName.toLowerCase()
      if (!/^h[1-6]$/.test(tag)) return

      const text = extractTextFromNode(node)
      // An unclaimed heading takes the counter's next id, so the fallbacks keep the document's own
      // order — an assigned id is one that numbering already gave out, not one to number onto.
      const id = prefix + (assigned?.get(normalizeHeadingText(text))?.shift() ?? fallback(text))
      node.properties = node.properties || {}
      if (!node.properties.id) node.properties.id = id
    })
  }
}
