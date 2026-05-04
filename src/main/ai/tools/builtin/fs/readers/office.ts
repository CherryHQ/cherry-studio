/**
 * Office reader. Routes through the shared `extractOfficeText` util in
 * `@main/utils/file` so library choice (officeparser + word-extractor
 * for `.doc`) and `.doc` handling stay in one place — the same util
 * `FileStorage.readFileCore` uses.
 *
 * Failures (corrupt, password-protected, unsupported subformats) bubble
 * up — the dispatcher catches and maps to `parse-error`.
 */

import { extractOfficeText, OFFICE_DOCUMENT_EXTENSIONS } from '@main/utils/file'

import { formatLines, type TextReadResult } from './text'

export const OFFICE_EXTENSIONS = OFFICE_DOCUMENT_EXTENSIONS

export async function readAsOffice(
  absolutePath: string,
  offset: number | undefined,
  limit: number | undefined
): Promise<TextReadResult> {
  const text = await extractOfficeText(absolutePath)
  return formatLines(text, offset, limit)
}
