import type { Root } from 'hast'
import { visit } from 'unist-util-visit'

/**
 * 基于 GitHub 风格的标题 slug 生成器（去重逻辑）
 * - 小写
 * - 去除前后空白
 * - 移除部分标点
 * - 将空白与非字母数字字符合并为单个 '-'
 * - 多次出现的相同 slug 加上递增后缀（-1, -2...）
 */
export function createSlugger() {
  const seen = new Map<string, number>()
  const normalize = (text: string): string => {
    let slug = (text || '')
      .toLowerCase()
      .trim()
      // 移除常见分隔符和标点
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // 零宽字符
      .replace(/["'`''""(){}[\]:;!?.,]/g, '')
      // 将空白和非字母数字字符转换为 '-'
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      // 合并多余的 '-'
      .replace(/-{2,}/g, '-')
      // 去除首尾 '-'
      .replace(/^-|-$/g, '')

    if (!slug) slug = 'section'
    return slug
  }

  const slug = (text: string): string => {
    const base = normalize(text)
    const count = seen.get(base) || 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base}-${count}`
  }

  return { slug }
}

export function extractTextFromNode(node: any): string {
  if (!node) return ''
  if (typeof node.value === 'string') return node.value
  if (node.children?.length) return node.children.map(extractTextFromNode).join('')
  return ''
}

export default function rehypeHeadingIds(options?: { prefix?: string }) {
  return (tree: Root) => {
    const slugger = createSlugger()
    const prefix = options?.prefix ? `${options.prefix}--` : ''
    visit(tree, 'element', (node) => {
      if (!node || typeof node.tagName !== 'string') return
      const tag = node.tagName.toLowerCase()
      if (!/^h[1-6]$/.test(tag)) return

      const text = extractTextFromNode(node)
      const id = prefix + slugger.slug(text)
      node.properties = node.properties || {}
      if (!node.properties.id) node.properties.id = id
    })
  }
}
