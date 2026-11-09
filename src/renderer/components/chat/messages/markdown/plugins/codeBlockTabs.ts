import type { Element, Root as HastRoot, RootContent } from 'hast'
import type { Code, Root as MdastRoot } from 'mdast'
import remarkParse from 'remark-parse'
import { type Plugin, unified } from 'unified'
import { visit } from 'unist-util-visit'

import { createLatexMarkdownBlockParser } from '@renderer/components/markdown'

import { getCodeFilePath } from '../codeFilePath'

export const CODE_BLOCK_TABS_PROPERTY = 'cherryCodeBlockTabs'
const parser = unified().use(remarkParse).freeze()

function isEligibleFence(node: Code, source: string) {
  const start = node.position?.start.offset
  return (
    start !== undefined &&
    (source[start] === '`' || source[start] === '~') &&
    !getCodeFilePath({ text: node.value, language: node.lang ?? null })
  )
}

export const remarkCodeBlockTabs: Plugin<[], MdastRoot> = () => (tree, file) => {
  const languages = new Map<number, string>()
  const source = String(file)
  visit(tree, 'code', (node) => {
    if (isEligibleFence(node, source)) languages.set(node.position!.start.offset!, node.lang ?? '')
  })
  file.data.codeBlockTabLanguages = languages
}

export const rehypeCodeBlockTabs: Plugin<[], HastRoot> = () => (tree, file) => {
  const languages = file.data.codeBlockTabLanguages
  if (!(languages instanceof Map)) return
  const getLanguage = (node: RootContent) => {
    const value: unknown =
      node.type === 'element' && node.tagName === 'pre' && node.position?.start.offset !== undefined
        ? languages.get(node.position.start.offset)
        : undefined
    return typeof value === 'string' ? value : undefined
  }

  visit(tree, (parent) => {
    if (parent.type !== 'root' && parent.type !== 'element') return
    if (parent.type === 'element' && parent.properties[CODE_BLOCK_TABS_PROPERTY]) return
    for (let index = 0; index < parent.children.length; index++) {
      const first = parent.children[index]
      if (first.type !== 'element') continue
      const language = getLanguage(first)
      if (language === undefined) continue
      const labels = [language]
      const blocks = [first]
      let end = index + 1
      let next = end
      while (next < parent.children.length) {
        const child = parent.children[next]
        if (child.type === 'text' && !child.value.trim()) {
          next++
          continue
        }
        const nextLanguage = getLanguage(child)
        if (child.type !== 'element' || nextLanguage === undefined) break
        labels.push(nextLanguage)
        blocks.push(child)
        end = ++next
      }
      if (blocks.length < 2) continue
      const group: Element = {
        type: 'element',
        tagName: 'div',
        properties: { [CODE_BLOCK_TABS_PROPERTY]: labels },
        children: blocks,
        position: first.position
      }
      parent.children.splice(index, end - index, group)
    }
  })
}

export function createChatMarkdownBlockParser() {
  const parseBlocks = createLatexMarkdownBlockParser()
  let previous = new Map<string, boolean>()
  return (source: string): string[] => {
    const cache = new Map<string, boolean>()
    const result: string[] = []
    let previousWasFence = false
    for (const block of parseBlocks(source)) {
      if (!block.trim() && result.length) {
        result[result.length - 1] += block
        continue
      }
      let eligible = previous.get(block)
      if (eligible === undefined) {
        const tree = parser.parse(block)
        const node = tree.children[0]
        eligible = tree.children.length === 1 && node?.type === 'code' && isEligibleFence(node, block)
      }
      cache.set(block, eligible)
      if (eligible && previousWasFence) result[result.length - 1] += block
      else result.push(block)
      previousWasFence = eligible
    }
    previous = cache
    return result
  }
}
