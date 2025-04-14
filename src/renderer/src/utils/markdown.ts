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
