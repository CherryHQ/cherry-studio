import type { DocumentAnchor } from '@renderer/types/selectionReference'

/**
 * Derives a DOCX paragraph anchor + plain-text excerpt from the current DOM
 * selection inside the docx-preview render. Relies on the `data-docx-part` /
 * `data-docx-index` / `data-para-id` attributes added by the repo's
 * `docx-preview` patch.
 *
 * Returns null unless the selection starts inside a **body-level** paragraph:
 * `paragraph` is a required anchor field, and only body paragraphs carry an
 * ordinal that matches the document's own addressing. Selections in headers,
 * footers, footnotes, endnotes, comments or table cells therefore produce no
 * anchor at all rather than a half-truthful one.
 *
 * A cross-paragraph selection anchors to its starting paragraph; the excerpt
 * still spans the whole selection.
 *
 * Never resolve `data-para-id` with a global query — headers/footers and
 * footnotes are re-rendered per page, so the same id appears many times.
 */
export function selectionToDocxAnchor(selection: Selection): { anchor: DocumentAnchor; excerpt: string } | null {
  if (selection.isCollapsed || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  const startNode = range.startContainer
  const startElement = startNode.nodeType === Node.ELEMENT_NODE ? (startNode as Element) : startNode.parentElement
  const paragraphElement = startElement?.closest<HTMLElement>('[data-docx-index]')
  if (!paragraphElement || paragraphElement.dataset.docxPart !== 'body') return null

  const paragraph = Number(paragraphElement.dataset.docxIndex)
  if (!Number.isInteger(paragraph) || paragraph < 0) return null

  const paraId = paragraphElement.dataset.paraId

  return {
    anchor: { format: 'docx', paragraph, ...(paraId ? { paraId } : {}) },
    excerpt: range.toString()
  }
}
