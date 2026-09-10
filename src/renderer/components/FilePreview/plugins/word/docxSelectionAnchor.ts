import type { DocumentAnchor } from '@renderer/types/selectionReference'

/**
 * Derives a DOCX paragraph anchor + plain-text excerpt from an element the user picked inside the
 * docx-preview render. Relies on the `data-docx-part` / `data-docx-index` / `data-para-id`
 * attributes added by the repo's `docx-preview` patch.
 *
 * Returns null unless the pick lands in a **body-level** paragraph: `paragraph` is a required anchor
 * field, and only body paragraphs carry an ordinal that matches the document's own addressing.
 * Headers, footers, footnotes, endnotes, comments and table cells therefore produce no anchor at all
 * rather than a half-truthful one.
 *
 * The innermost paragraph is resolved and the ordinal is required on that exact element: docx-preview
 * parses `w:txbxContent` through `parseBodyElements` without a part, so a text box's paragraphs carry
 * no ordinal while the body paragraph wrapping the shape does. Matching `[data-docx-index]` directly
 * would skip past the text box and anchor to the outer paragraph, which a later edit would then
 * replace instead of the text the user actually picked.
 *
 * Never resolve `data-para-id` with a global query — headers/footers and footnotes are re-rendered
 * per page, so the same id appears many times.
 */
export function paragraphToDocxAnchor(
  element: Element
): { anchor: DocumentAnchor; excerpt: string; element: HTMLElement } | null {
  const paragraphElement = element.closest<HTMLElement>('p')
  if (!paragraphElement || paragraphElement.dataset.docxPart !== 'body') return null

  const paragraph = Number(paragraphElement.dataset.docxIndex)
  if (!Number.isInteger(paragraph) || paragraph < 0) return null

  const paraId = paragraphElement.dataset.paraId

  return {
    anchor: { format: 'docx', paragraph, ...(paraId ? { paraId } : {}) },
    excerpt: paragraphElement.textContent ?? '',
    // The resolved paragraph itself, so the caller marks the element the ordinal came from instead
    // of resolving `closest('p')` a second time and risking a different answer.
    element: paragraphElement
  }
}
