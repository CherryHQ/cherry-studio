import type { Editor } from '@tiptap/core'

/** Resolve a source line to its rendered top-level block using the editor's Markdown serializer. */
export function findElementByLine(editor: Editor, lineNumber: number, lineContent?: string): HTMLElement | null {
  const doc = editor.getJSON()
  const markdown = editor.getMarkdown()
  const needle = lineContent?.trim()
  let cursor = 0
  let currentLine = 1
  let nearest: HTMLElement | null = null
  let nearestDistance = Infinity
  let match: HTMLElement | null = null
  let matchDistance = Infinity

  editor.state.doc.forEach((_node, position, index) => {
    const source = editor.markdown!.renderNodeToMarkdown(doc.content[index], doc, index)
    const start = markdown.indexOf(source, cursor)
    if (!source || start < 0) return

    currentLine += markdown.slice(cursor, start).split('\n').length - 1
    const lines = source.split('\n')
    const endLine = currentLine + lines.length - 1
    const element = editor.view.nodeDOM(position)
    if (element instanceof HTMLElement) {
      const distance = Math.max(currentLine - lineNumber, lineNumber - endLine, 0)
      if (distance < nearestDistance) {
        nearest = element
        nearestDistance = distance
      }

      // Source lines retain table, code and HTML syntax; no isolated-line parsing is needed.
      if (needle) {
        lines.forEach((line, offset) => {
          const distance = Math.abs(currentLine + offset - lineNumber)
          if (line.trim() === needle && distance < matchDistance) {
            match = element
            matchDistance = distance
          }
        })
      }
    }
    cursor = start + source.length
    currentLine = endLine
  })

  return match ?? nearest
}
