import { ClaudePluginsSearchResponseSchema, type SkillSearchResult, type SkillSearchSource } from '@shared/types/skill'

/**
 * Shared normalizer for the claude-plugins.dev marketplace response. Used by both the renderer
 * search UI (`skillSearch.ts`) and the main-process `skills` MCP server so they build install
 * identifiers by the SAME rule — from the real `directoryPath`, never the display name.
 *
 * An entry whose install source can't be resolved reliably (missing repo owner/name, or no
 * `directoryPath`) is dropped: cloning + scanning a repo without an exact directory can install a
 * different skill than the one the user picked, so we fail closed rather than guess.
 */

function normalizeDirectoryPath(directoryPath: string | null | undefined): string | null {
  const normalized = directoryPath
    ?.split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/')

  return normalized || null
}

function getDirectoryPathFromGithubTreeUrl(
  sourceUrl: string | null | undefined,
  repoOwner: string,
  repoName: string
): string | null {
  if (!sourceUrl) return null

  try {
    const url = new URL(sourceUrl)
    const [owner, repo, type, branch, ...pathParts] = url.pathname
      .split('/')
      .filter(Boolean)
      .map((part) => decodeURIComponent(part))

    if (
      url.hostname !== 'github.com' ||
      owner?.toLowerCase() !== repoOwner.toLowerCase() ||
      repo?.toLowerCase() !== repoName.toLowerCase() ||
      type !== 'tree' ||
      !branch ||
      !['main', 'master'].includes(branch)
    ) {
      return null
    }

    return normalizeDirectoryPath(pathParts.join('/'))
  } catch {
    return null
  }
}

export function normalizeClaudePlugins(raw: unknown): SkillSearchResult[] {
  const parsed = ClaudePluginsSearchResponseSchema.safeParse(raw)
  if (!parsed.success) throw new Error('Invalid claude-plugins.dev search response')

  return parsed.data.skills.flatMap((s) => {
    const repoOwner = s.metadata?.repoOwner ?? ''
    const repoName = s.metadata?.repoName ?? ''
    const directoryPath =
      normalizeDirectoryPath(s.metadata?.directoryPath) ??
      getDirectoryPathFromGithubTreeUrl(s.sourceUrl, repoOwner, repoName)
    // Skip entries without a resolvable install source (repo owner/name are required to clone,
    // directoryPath is required to avoid ambiguous repo scans that may install a different skill).
    if (!repoOwner || !repoName || !directoryPath) return []
    return {
      slug: s.id,
      name: s.name,
      description: s.description ?? null,
      author: s.author ?? s.namespace ?? null,
      stars: s.stars ?? 0,
      downloads: s.installs ?? 0,
      sourceRegistry: 'claude-plugins.dev' as SkillSearchSource,
      sourceUrl: s.sourceUrl ?? `https://github.com/${repoOwner}/${repoName}/tree/main/${directoryPath}`,
      // The install identifier is owner/repo/directoryPath — the REAL directory, not the display name.
      installSource: `claude-plugins:${repoOwner}/${repoName}/${directoryPath}`
    }
  })
}
