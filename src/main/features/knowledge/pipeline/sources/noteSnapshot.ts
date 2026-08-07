import { deriveNoteSnapshotSlug, getKnowledgeNoteFirstLine } from '@shared/data/types/knowledge'

import { reserveImportedFileRelativePath, writeFileIntoKnowledgeBaseAt } from '../../pathStorage'
import { serializeOkfFrontmatter } from './okfFrontmatter'

// Owned by the shared knowledge contract: same-name detection has to predict this slug for a note
// that has not been captured yet, so the two cannot be allowed to drift apart.
export { deriveNoteSnapshotSlug }

/**
 * Build a captured note snapshot's file content and its slug (no extension),
 * without touching disk. Mirrors {@link buildUrlSnapshotFile}: the content is
 * prefixed with an OKF frontmatter block recording the note's title; reading for
 * indexing strips it back off to recover the canonical `content.text`. Shared by
 * {@link captureNoteSnapshotFile} and the v1→v2 vector migrator; the caller supplies
 * the `timestamp` (frontmatter-only, so it never affects a content hash).
 */
export function buildNoteSnapshotFile(
  source: string,
  content: string,
  timestamp: string
): { slug: string; fileText: string } {
  const frontmatter = serializeOkfFrontmatter({
    type: 'Note',
    // The same first-line name the slug and the conflict key use: a migrated `source` can be the
    // entire note body, and recording that as the title would restate the body in the header.
    title: getKnowledgeNoteFirstLine(source),
    timestamp
  })
  return {
    slug: deriveNoteSnapshotSlug(source),
    fileText: frontmatter + content
  }
}

/**
 * Write a note's content into the base as a markdown snapshot under a
 * collision-free, readable name and return its base-relative path. Mirrors
 * captureUrlSnapshotFile but takes the content directly (no network fetch).
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
  const { slug, fileText } = buildNoteSnapshotFile(source, content, new Date().toISOString())
  const relativePath = reserveImportedFileRelativePath(`${slug}.md`, false, reservedPaths)
  return await writeFileIntoKnowledgeBaseAt(baseId, relativePath, fileText)
}
