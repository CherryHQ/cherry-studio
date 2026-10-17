import { codeLanguages } from '@shared/utils/codeLanguages'


/**
 * Media catalogs are curated from mime-db (the IANA-backed type→extension
 * database): every entry must exist there under the catalog's own type, and
 * `fileExtensions.test.ts` enforces both that grounding and cross-catalog
 * uniqueness. Curate for formats users actually hold — not every registered
 * type. To extend: verify the extension in mime-db, add it here, run the tests.
 *
 * `.ts`/`.mts` are deliberately absent despite mime-db's video/mp2t entry:
 * TypeScript owns them here, and the shared classifier already resolves both
 * as text.
 *
 * `.svg`/`.svgz` are deliberately absent despite mime-db's image/svg+xml
 * entry: codeLanguages owns them as source text, and the text-only agent
 * guard (`unsupportedImageRead` in `src/main/ai/runtime/claudeCode`) uses
 * this catalog to decide which files a text-only model may read — SVG
 * sources must stay readable. The image preview plugin re-adds them as
 * preview-only literals.
 *
 * `.dts` is deliberately absent despite mime-db's audio/vnd.dts entry: it
 * also names Linux Device Tree source files, which are UTF-8 text. An
 * extension-based catalog cannot serve both, and the audio claim wins over
 * the content-based text fallback in `getFileType` — so a valid `board.dts`
 * would be rejected by chat's attach gate and lose its preview and editing.
 * Leaving it unclassified lets those sources classify as text by content.
 *
 * `.mid` is deliberately absent for the same reason: MapInfo MIF/MID pairs
 * store the CSV-like attribute table in a plain-text `.mid` file, while the
 * unambiguous `.midi` keeps serving real MIDI audio.
 */
export const imageExts = [
  '.apng',
  '.avif',
  '.bmp',
  '.dng',
  '.gif',
  '.heic',
  '.heif',
  '.ico',
  '.jfif',
  '.jpe',
  '.jpeg',
  '.jpg',
  '.jp2',
  '.jxl',
  '.ktx2',
  '.png',
  '.psd',
  '.tif',
  '.tiff',
  '.webp'
]
export const videoExts = [
  '.3g2',
  '.3gp',
  '.asf',
  '.avi',
  '.f4v',
  '.flv',
  '.m2ts',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.mpeg',
  '.mpg',
  '.ogv',
  '.qt',
  '.webm',
  '.wmv'
]
export const audioExts = [
  '.aac',
  '.aif',
  '.aifc',
  '.aiff',
  '.amr',
  '.au',
  '.caf',
  '.flac',
  '.m4a',
  '.m4b',
  '.mka',
  '.midi',
  '.mp2',
  '.mp3',
  '.mpga',
  '.oga',
  '.ogg',
  '.opus',
  '.ra',
  '.wav',
  '.weba',
  '.wma'
]
 c089638bb4 (feat(file-extensions): ground the media catalogs in mime-db)
export const documentExts = ['.pdf', '.doc', '.docx', '.pptx', '.xlsx', '.xls', '.odt', '.odp', '.ods']
export const archiveExts = ['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.bz2', '.