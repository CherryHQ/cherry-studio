import type { Point } from 'unist'

export const findCitationInChildren = (children: any): string => {
  if (!children) return ''

  for (const child of Array.isArray(children) ? children : [children]) {
    if (typeof child === 'object' && child?.props?.['data-citation']) return child.props['data-citation']
    if (typeof child === 'object' && child?.props?.children) {
      const found = findCitationInChildren(child.props.children)
      if (found) return found
    }
  }

  return ''
}

const containsLatexRegex = /\\\(.*?\\\)|\\\[.*?\\\]/s

export const processLatexBrackets = (text: string) => {
  if (!containsLatexRegex.test(text)) return text

  const protectedItems: string[] = []
  let processedContent = text
    .replace(/(```[\s\S]*?```|`[^`]*`)/g, (match) => {
      const index = protectedItems.length
      protectedItems.push(match)
      return `__CHERRY_STUDIO_PROTECTED_${index}__`
    })
    .replace(/\[([^[\]]*(?:\[[^\]]*\][^[\]]*)*)\]\([^)]*?\)/g, (match) => {
      const index = protectedItems.length
      protectedItems.push(match)
      return `__CHERRY_STUDIO_PROTECTED_${index}__`
    })

  const processMath = (content: string, openDelim: string, closeDelim: string, wrapper: string): string => {
    let result = ''
    let remaining = content
    while (remaining.length > 0) {
      const match = findLatexMatch(remaining, openDelim, closeDelim)
      if (!match) return result + remaining
      result += `${match.pre}${wrapper}${match.body}${wrapper}`
      remaining = match.post
    }
    return result
  }

  processedContent = processMath(processedContent, '\\[', '\\]', '$$')
  processedContent = processMath(processedContent, '\\(', '\\)', '$')
  return processedContent.replace(/__CHERRY_STUDIO_PROTECTED_(\d+)__/g, (match, indexValue) => {
    const item = protectedItems[Number.parseInt(indexValue, 10)]
    return item ?? match
  })
}

function findLatexMatch(text: string, openDelim: string, closeDelim: string) {
  const escaped = (index: number) => {
    let count = 0
    while (--index >= 0 && text[index] === '\\') count += 1
    return count & 1
  }

  for (let index = 0; index <= text.length - openDelim.length; index += 1) {
    if (!text.startsWith(openDelim, index) || escaped(index)) continue

    for (let cursor = index + openDelim.length, depth = 1; cursor <= text.length - closeDelim.length; cursor += 1) {
      const delta =
        text.startsWith(openDelim, cursor) && !escaped(cursor)
          ? 1
          : text.startsWith(closeDelim, cursor) && !escaped(cursor)
            ? -1
            : 0
      if (!delta) continue
      depth += delta
      if (!depth) {
        return {
          pre: text.slice(0, index),
          body: text.slice(index + openDelim.length, cursor),
          post: text.slice(cursor + closeDelim.length)
        }
      }
      cursor += (delta > 0 ? openDelim : closeDelim).length - 1
    }
  }
  return null
}

export function convertMathFormula(input: string): string {
  return input
    ? input.replaceAll('\\[', '$$$$').replaceAll('\\]', '$$$$').replaceAll('\\(', '$$').replaceAll('\\)', '$$')
    : input
}

export function removeTrailingDoubleSpaces(markdown: string): string {
  return markdown.replace(/ {2}$/gm, '')
}

export function getCodeBlockId(start?: Point): string | null {
  return start ? `${start.line}:${start.column}:${start.offset}` : null
}

export function isHtmlCode(code: string | null): boolean {
  if (!code?.trim()) return false
  const html = code.trim().toLowerCase()
  if (
    ['<!doctype html>', '<html', '</html>', '<head', '</head>', '<body', '</body>'].some((marker) =>
      html.includes(marker)
    )
  ) {
    return true
  }
  if (
    [
      '<div',
      '<span',
      '<p',
      '<a',
      '<img',
      '<svg',
      '<table',
      '<ul',
      '<ol',
      '<section',
      '<header',
      '<footer',
      '<nav',
      '<article',
      '<button',
      '<form',
      '<input'
    ].some((tag) => html.includes(tag))
  ) {
    return true
  }
  return /<([a-z0-9]+)([^>]*?)>(.*?)<\/\1>|<([a-z0-9]+)([^>]*?)\/>/.test(html)
}

export function purifyMarkdownImages(markdown: string): string {
  return markdown.replace(
    /(!\[[^\]]*\]\()\s*data:image\/[\w+.-]+;base64\s*,[\w+/=]+(?:\s*[\w+/=]+)*\s*\)/gi,
    '$1image_url)'
  )
}
