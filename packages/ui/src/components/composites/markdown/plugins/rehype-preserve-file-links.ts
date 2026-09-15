import type { Element, Root } from 'hast'
import { visit } from 'unist-util-visit'

export const FILE_LINK_MARKER_PROPERTY = 'dataMarkdownFileHref'

const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i
const WINDOWS_DRIVE_PATH_PATTERN = /^[a-z]:[/\\]/i
const ASCII_CONTROL_CHARACTER_MAX_CODE = 0x1f
const ASCII_DELETE_CHARACTER_CODE = 0x7f

function containsAsciiControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= ASCII_CONTROL_CHARACTER_MAX_CODE || code === ASCII_DELETE_CHARACTER_CODE) return true
  }
  return false
}

function isFileLinkHref(href: unknown): href is string {
  if (
    typeof href !== 'string' ||
    !href ||
    href.startsWith('#') ||
    href.startsWith('//') ||
    href.startsWith(' ') ||
    containsAsciiControlCharacter(href)
  ) {
    return false
  }
  return WINDOWS_DRIVE_PATH_PATTERN.test(href) || !URI_SCHEME_PATTERN.test(href)
}

export function rehypePrepareFileLinks() {
  return (tree: Root): void => {
    visit(tree, 'element', (node: Element) => {
      delete node.properties[FILE_LINK_MARKER_PROPERTY]

      if (node.tagName === 'a' && typeof node.properties.href === 'string') {
        if (node.properties.href.startsWith('//')) node.properties.href = `https:${node.properties.href}`
      }
      if (node.tagName === 'img' && typeof node.properties.src === 'string' && node.properties.src.startsWith('//')) {
        node.properties.src = `https:${node.properties.src}`
      }
      if (node.tagName !== 'a' || !isFileLinkHref(node.properties.href)) return

      node.tagName = 'span'
      node.properties[FILE_LINK_MARKER_PROPERTY] = node.properties.href
      delete node.properties.href
    })
  }
}

export function rehypeRestoreFileLinks() {
  return (tree: Root): void => {
    visit(tree, 'element', (node: Element) => {
      const href = node.properties[FILE_LINK_MARKER_PROPERTY]
      if (node.tagName !== 'span' || typeof href !== 'string') return

      node.tagName = 'a'
      node.properties.href = href
      delete node.properties[FILE_LINK_MARKER_PROPERTY]
    })
  }
}
