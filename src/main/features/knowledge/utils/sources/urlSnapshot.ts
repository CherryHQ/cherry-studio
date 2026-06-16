import { sanitizeFilename } from '@shared/file/types/filename'

import { reserveImportedFileRelativePath, writeFileIntoKnowledgeBaseAt } from '../storage/pathStorage'
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
 * Write a captured URL snapshot into the base under a collision-free, readable
 * name and return its base-relative path. `reservedPaths` is the set of names
 * already occupied in the base; callers build it and call this under the base
 * mutation lock so two concurrent captures cannot pick the same path.
 *
 * The file is the markdown prefixed with the OKF frontmatter block, which
 * records the source URL and title on the file itself; reading for indexing
 * strips it back off.
 */
export async function captureUrlSnapshotFile(
  baseId: string,
  url: string,
  markdown: string,
  reservedPaths: Set<string>
): Promise<string> {
  const relativePath = reserveImportedFileRelativePath(
    `${deriveUrlSnapshotSlug(markdown, url)}.md`,
    false,
    reservedPaths
  )
  const frontmatter = serializeOkfFrontmatter({
    type: 'URL',
    title: deriveUrlSnapshotTitle(markdown, url),
    resource: url,
    timestamp: new Date().toISOString()
  })
  return await writeFileIntoKnowledgeBaseAt(baseId, relativePath, frontmatter + markdown)
}
