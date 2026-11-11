import type { JSONContent } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

import { remarkLatexMath } from '@renderer/utils/remarkLatexMath'

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkLatexMath).freeze()
const FRONTMATTER = /^(?:\uFEFF)?---[^\S\r\n]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[^\S\r\n]*(?:\r?\n|$)/

export function previewSource(source: string): string {
  return source.replace(FRONTMATTER, (match) => match.replace(/[^\r\n]/g, ' '))
}

export function sourceDocument(text: string): JSONContent {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      ...(line ? { content: [{ type: 'text', text: line }] } : {})
    }))
  }
}

export function documentSource(doc: ProseMirrorNode): string {
  const lines: string[] = []
  doc.forEach((line) => lines.push(line.textContent))
  return lines.join('\n')
}

export function documentBlocks(source: string) {
  return parser.parse(previewSource(source)).children.flatMap((node) => {
    const from = node.position?.start.offset
    const to = node.position?.end.offset
    return from === undefined || to === undefined
      ? []
      : [{ from, to, type: node.type, rendered: node.type !== 'definition' && node.type !== 'footnoteDefinition' }]
  })
}
