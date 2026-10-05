/**
 * Text of a legacy binary Word document (`.doc`, OLE2 compound format).
 *
 * Takes the bytes or a path, whichever the caller already has.
 *
 * `Document#getBody()` is only the main story. A `.doc` keeps text boxes,
 * footnotes and endnotes in streams of their own, and Word puts all of them on
 * the page, so reading the body alone silently drops every callout, pull quote
 * and footnote.
 *
 * Comments (`getAnnotations()`) stay out: they are remarks *about* the document
 * rather than part of it. Headers and footers stay out for the same reason the
 * other extractors leave them out — they repeat page furniture on every page.
 * Text boxes anchored in a header are kept, because `getTextboxes()` returns
 * them once rather than once per page, and a banner or a sidebar is content.
 */
export async function extractLegacyDocText(source: Buffer | string): Promise<string> {
  const { default: WordExtractor } = await import('word-extractor')
  const extracted = await new WordExtractor().extract(source)

  return [extracted.getBody(), extracted.getTextboxes(), extracted.getFootnotes(), extracted.getEndnotes()]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n')
}
