import { sanitizeFilename } from '@shared/utils/file'

import { reserveImportedFileRelativePath, writeFileIntoKnowledgeBaseAt } from '../pathStorage'
import { serializeOkfFrontmatter } from './okfFrontmatter'

const SNAPSHOT_TITLE_MAX = 80

/**
 * Derive a human-readable file stem for a captured URL snapshot: the page's
 * first markdown heading (or first non-empty line), falling back to a slug of
 * the URL host and last path segment, and finally to `page`.
 */
export function deriveUrlSnapshotSlug(markdown: string, url: string): string {
  const fromMarkdown = sanitizeFilename(firstHeadingOrLine(markdown).slice(0, SNAPSHOT_TITLE_MAX).trim())
  if (fromMarkdown && fromMarkdown !== 'untitled') {
    return fromMarkdown
  }
  const fromUrl = sanitizeFilename(urlStem(url).slice(0, SNAPSHOT_TITLE_MAX).trim())
  if (fromUrl && fromUrl !== 'untitled') {
    return fromUrl
  }
  return 'page'
}

/**
 * The page's display title for the OKF `title` field: the first markdown
 * heading (or non-empty line), unsanitized, capped at {@link SNAPSHOT_TITLE_MAX};
 * falls back to the URL host + last segment, then the raw URL. Unlike the slug
 * this keeps spaces/punctuation, since it is a frontmatter value, not a filename.
 */
export function deriveUrlSnapshotTitle(markdown: string, url: string): string {
  const fromMarkdown = firstHeadingOrLine(markdown).slice(0, SNAPSHOT_TITLE_MAX).trim()
  if (fromMarkdown) {
    return fromMarkdown
  }
  return urlStem(url).slice(0, SNAPSHOT_TITLE_MAX).trim() || url
}

function firstHeadingOrLine(markdown: string): string {
  const lines = markdown.split('\n').map((line) => line.trim())
  const heading = lines.find((line) => /^#{1,6}\s+/.test(line))
  if (heading) {
    return heading.replace(/^#{1,6}\s+/, '')
  }
  return lines.find(Boolean) ?? ''
}

function urlStem(url: string): string {
  try {
    const parsed = new URL(url)
    const lastSegment = parsed.pathname.split('/').filter(Boolean).pop()
    return [parsed.hostname, lastSegment].filter(Boolean).join('-')
  } catch {
    return ''
  }
}

/**
 * Build a captured URL snapshot's file content and its human-readable slug (no
 * extension), without touching disk. The `fileText` is the markdown prefixed with
 * an OKF frontmatter block recording the source URL and title; reading for indexing
 * strips it back off. Shared by {@link captureUrlSnapshotFile} (native capture) and
 * the v1→v2 vector migrator so both produce byte-identical snapshots; the caller
 * supplies the `timestamp` (frontmatter-only, so it never affects a content hash).
 */
export function buildUrlSnapshotFile(
  url: string,
  markdown: string,
  timestamp: string
): { slug: string; fileText: string } {
  const frontmatter = serializeOkfFrontmatter({
    type: 'URL',
    title: deriveUrlSnapshotTitle(markdown, url),
    resource: url,
    timestamp
  })
  return {
    slug: deriveUrlSnapshotSlug(markdown, url),
    fileText: frontmatter + markdown
  }
}

/**
 * Write a captured URL snapshot into the base under a collision-free, readable
 * name and return its base-relative path. `reservedPaths` is the set of names
 * already occupied in the base; callers build it and call this under the base
 * mutation lock so two concurrent captures cannot pick the same path.
 */
export async function captureUrlSnapshotFile(
  baseId: string,
  url: string,
  markdown: string,
  reservedPaths: Set<string>
): Promise<string> {
  const { slug, fileText } = buildUrlSnapshotFile(url, markdown, new Date().toISOString())
  const relativePath = reserveImportedFileRelativePath(`${slug}.md`, false, reservedPaths)
  return await writeFileIntoKnowledgeBaseAt(baseId, relativePath, fileText)
}
