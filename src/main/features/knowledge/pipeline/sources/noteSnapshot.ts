import { sanitizeFilename } from '@shared/utils/file'

import { reserveImportedFileRelativePath, writeFileIntoKnowledgeBaseAt } from '../../pathStorage'
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
    title: source,
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
