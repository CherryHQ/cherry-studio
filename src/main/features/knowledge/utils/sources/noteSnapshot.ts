import { sanitizeFilename } from '@shared/utils/file/filename'

import { reserveImportedFileRelativePath, writeFileIntoKnowledgeBaseAt } from '../storage/pathStorage'
import { serializeOkfFrontmatter } from './okfFrontmatter'

const SNAPSHOT_TITLE_MAX = 80

/**
 * Derive a human-readable file stem for a captured note snapshot from its
 * user-facing source title, falling back to `note` when sanitizing yields
 * nothing usable.
 */
export function deriveNoteSnapshotSlug(source: string): string {
  const sanitized = sanitizeFilename(source.slice(0, SNAPSHOT_TITLE_MAX).trim())
  if (sanitized && sanitized !== 'untitled') {
    return sanitized
  }
  return 'note'
}

/**
 * Write a note's content into the base as a markdown snapshot under a
 * collision-free, readable name and return its base-relative path. Mirrors
 * captureUrlSnapshotFile but takes the content directly (no network fetch). The
 * content is prefixed with an OKF frontmatter block recording the note's title;
 * reading for indexing strips it back off to recover the canonical `content.text`.
 *
 * `reservedPaths` is the set of names already occupied in the base; callers
 * build it and call this under the base mutation lock so two concurrent captures
 * cannot pick the same path.
 */
export async function captureNoteSnapshotFile(
  baseId: string,
  source: string,
  content: string,
  reservedPaths: Set<string>
): Promise<string> {
  const relativePath = reserveImportedFileRelativePath(`${deriveNoteSnapshotSlug(source)}.md`, false, reservedPaths)
  const frontmatter = serializeOkfFrontmatter({
    type: 'Note',
    title: source,
    timestamp: new Date().toISOString()
  })
  return await writeFileIntoKnowledgeBaseAt(baseId, relativePath, frontmatter + content)
}
