/**
 * Pure text-paging helpers shared by the eager inline cap (`attachmentRouting`)
 * and `read_file` pagination (`fileLookup`), so both agree on where a page may
 * end. No I/O, no domain types.
 */

/** Don't split a surrogate pair at a page boundary: back off one unit if `end`
 *  would land just after a lone high surrogate. */
export function surrogateSafeEnd(text: string, end: number): number {
  if (end > 0 && end < text.length) {
    const c = text.charCodeAt(end - 1)
    if (c >= 0xd800 && c <= 0xdbff) return end - 1
  }
  return end
}
