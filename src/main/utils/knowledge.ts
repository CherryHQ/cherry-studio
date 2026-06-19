import path from 'node:path'

export const DEFAULT_DOCUMENT_COUNT = 6
export const DEFAULT_RELEVANT_SCORE = 0

/**
 * Return the first variant of `relativePath` that satisfies `isFree`, starting from the
 * bare path and then inserting an incrementing `_N` suffix before the extension
 * (`report.pdf` → `report_1.pdf` → `report_2.pdf` …). `isFree` decides what "free" means,
 * so one caller can test a single reserved set while another also checks a processed
 * sibling per candidate. Pure: it mutates nothing — the caller commits the chosen path.
 *
 * Lives here (knowledge util) rather than `@main/utils/file` on purpose: it is the
 * knowledge base's interim collision handling for its `raw/<name>` store. Once the file
 * manager owns file identity (UUID storage), this can migrate to a unified dedup there.
 */
export function nextFreeKnowledgeRelativePath(
  relativePath: string,
  isFree: (candidate: string) => boolean,
  splitExtension = true
): string {
  // Directory prefixes are not filenames: a folder `report.v2` must dedupe to
  // `report.v2_1`, not `report_1.v2`. Callers pass splitExtension=false for those.
  const ext = splitExtension ? path.extname(relativePath) : ''
  const stem = relativePath.slice(0, relativePath.length - ext.length)

  for (let suffix = 0; ; suffix += 1) {
    const candidate = suffix === 0 ? relativePath : `${stem}_${suffix}${ext}`
    if (isFree(candidate)) {
      return candidate
    }
  }
}
