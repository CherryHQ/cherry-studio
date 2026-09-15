import type { DocumentAnchor } from '@renderer/types/selectionReference'

/**
 * Plain text of a rendered paragraph, spelled with the separators python-docx's `Paragraph.text`
 * emits — the string the office-transform skill checks the excerpt against.
 *
 * `textContent` is not that string. docx-preview renders a line break (`w:br` of the default
 * `textWrapping` type) as `<br>` and `w:noBreakHyphen` as `<wbr>`; neither holds text, while python
 * spells them `\n` and `-`, so an unchanged paragraph containing either fails the skill's anchor
 * containment check. Nothing else renders as `<wbr>`.
 *
 * `w:tab` needs no case: docx-preview renders it as a span holding U+2003, which is inside the
 * whitespace class `normalizeSelectionText` collapses — the same single space python's `\t` collapses
 * to. Every other element contributes no separator of its own, so recursing into it is the whole mapping.
 */
export function paragraphExcerpt(paragraph: HTMLElement): string {
  const walker = paragraph.ownerDocument.createTreeWalker(paragraph, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  let excerpt = ''
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      excerpt += node.nodeValue ?? ''
    } else if ((node as Element).localName === 'br') {
      excerpt += '\n'
    } else if ((node as Element).localName === 'wbr') {
      excerpt += '-'
    }
  }
  return excerpt
}

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
    excerpt: paragraphExcerpt(paragraphElement),
    // The resolved paragraph itself, so the caller marks the element the ordinal came from instead
    // of resolving `closest('p')` a second time and risking a different answer.
    element: paragraphElement
  }
}
