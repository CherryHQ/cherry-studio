import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'

// 更彻底的查找方法，递归搜索所有子元素
export const findCitationInChildren = (children) => {
  if (!children) return null

  // 直接搜索子元素
  for (const child of Array.isArray(children) ? children : [children]) {
    if (typeof child === 'object' && child?.props?.['data-citation']) {
      return child.props['data-citation']
    }

    // 递归查找更深层次
    if (typeof child === 'object' && child?.props?.children) {
      const found = findCitationInChildren(child.props.children)
      if (found) return found
    }
  }

  return null
}

/**
 * 根据代码块节点的起始位置生成 ID
 * @param start 代码块节点的起始位置
 * @returns 代码块在 Markdown 字符串中的 ID
 */
export function getCodeBlockId(start: any): string | null {
  return start ? `${start.line}:${start.column}:${start.offset}` : null
}

/**
 * 更新Markdown字符串中的代码块内容
 * @param raw 原始Markdown字符串
 * @param id 代码块ID，按位置生成
 * @param newContent 修改后的代码内容
 * @returns 替换后的Markdown字符串
 */
export function updateCodeBlock(raw: string, id: string, newContent: string): string {
  const tree = unified().use(remarkParse).parse(raw)
  visit(tree, 'code', (node) => {
    const startIndex = getCodeBlockId(node.position?.start)
    if (startIndex && id && startIndex === id) {
      node.value = newContent
    }
  })

  return unified().use(remarkStringify).stringify(tree)
}

export const MARKDOWN_ALLOWED_TAGS = [
  'style',
  'p',
  'div',
  'span',
  'b',
  'i',
  'strong',
  'em',
  'ul',
  'ol',
  'li',
  'table',
  'tr',
  'td',
  'th',
  'thead',
  'tbody',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'code',
  'br',
  'hr',
  'svg',
  'path',
  'circle',
  'rect',
  'line',
  'polyline',
  'polygon',
  'text',
  'g',
  'defs',
  'title',
  'desc',
  'tspan',
  'sub',
  'sup'
]

// rehype-sanitize配置
export const sanitizeSchema = {
  tagNames: MARKDOWN_ALLOWED_TAGS,
  attributes: {
    '*': ['className', 'style', 'id', 'title'],
    svg: ['viewBox', 'width', 'height', 'xmlns', 'fill', 'stroke'],
    path: ['d', 'fill', 'stroke', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin'],
    circle: ['cx', 'cy', 'r', 'fill', 'stroke'],
    rect: ['x', 'y', 'width', 'height', 'fill', 'stroke'],
    line: ['x1', 'y1', 'x2', 'y2', 'stroke'],
    polyline: ['points', 'fill', 'stroke'],
    polygon: ['points', 'fill', 'stroke'],
    text: ['x', 'y', 'fill', 'textAnchor', 'dominantBaseline'],
    g: ['transform', 'fill', 'stroke'],
    a: ['href', 'target', 'rel']
  }
}
