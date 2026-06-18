import type { JSONContent } from '@tiptap/core'

/**
 * Pick the inline content of a single-paragraph markdown parse.
 *
 * Used when pasting a single line into a non-empty block: parsing the clipboard markdown turns
 * markers like `**bold**` / `[text](url)` into real marks rather than literal text (which the
 * serializer would later escape), and returning only the paragraph's inline children lets the caller
 * splice them in without wrapping the paste in a new block.
 *
 * Returns null for anything that is not a lone paragraph (a heading / list / blockquote line, or an
 * empty parse) so the caller can fall back to inserting the raw text verbatim.
 */
export function pickInlinePasteContent(doc: JSONContent | undefined): JSONContent[] | null {
  const blocks = doc?.content
  if (blocks?.length === 1 && blocks[0].type === 'paragraph' && blocks[0].content?.length) {
    return blocks[0].content
  }
  return null
}
