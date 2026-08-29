import {
  ClaudePluginsSearchResponseSchema,
  ClawhubSearchResponseSchema,
  type SkillSearchResult,
  type SkillSearchSource,
  SkillsShSearchResponseSchema
} from '@shared/types/skill'

export const SKILL_SEARCH_FAILED_ERROR = 'skill_search_failed'

type MarketplaceSource = {
  name: SkillSearchSource
  buildUrl: (query: string) => string
  normalize: (raw: unknown) => SkillSearchResult[]
}

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

export type GithubSkillLocation = {
  owner: string
  repo: string
  refNamespace: 'heads' | 'tags' | null
  /** Decoded ref and path segments. Their boundary is resolved from the repository's actual refs. */
  refAndPath: string[]
  descriptorFileName: 'SKILL.md' | 'skill.md'
}

const GITHUB_REPO_PART = /^[a-zA-Z0-9_.-]+$/

function invalidPathPart(part: string): boolean {
  // A decoded `/` would silently change the depth the installer resolves, `\` does the same on
  // Windows, and a NUL cannot reach the filesystem; none can name a real GitHub entry.
  return (
    !part ||
    part !== part.trim() ||
    part === '.' ||
    part === '..' ||
    part.includes('\\') ||
    part.includes('/') ||
    part.includes('\0')
  )
}

/**
 * Re-encode a decoded repo path for use in a URL. `GithubSkillLocation.refAndPath` is decoded so
 * the installer can resolve it on disk; concatenating it raw would break the round-trip back through
 * `parseGithubSkillUrl` (a `#` in a directory name turns the rest of the URL into a fragment).
 */
export function encodeGithubPath(directoryPath: string): string {
  return directoryPath.split('/').map(encodeURIComponent).join('/')
}

/**
 * Parse a GitHub URL pointing at one skill's SKILL.md file, e.g.
 * `https://github.com/{owner}/{repo}/blob/{ref}/{dir}/SKILL.md` (or the `raw.githubusercontent.com`
 * form). The renderer validates input and `SkillService` resolves the install with this same parser,
 * so a URL the UI accepts is exactly one the installer can clone.
 *
 * The SKILL.md file name is required: the enclosing directory is what identifies the skill, and a
 * bare repo or tree URL would leave the installer guessing which of several skills was meant.
 */
export function parseGithubSkillUrl(rawUrl: string): GithubSkillLocation | null {
  let url: URL
  let segments: string[]
  try {
    const trimmedUrl = rawUrl.trim()
    url = new URL(trimmedUrl)
    const authorityEnd = trimmedUrl.indexOf('/', trimmedUrl.indexOf('://') + 3)
    const rawPath = authorityEnd === -1 ? '' : trimmedUrl.slice(authorityEnd).split(/[?#]/, 1)[0]
    const rawSegments = rawPath.split('/').filter(Boolean).map(decodeURIComponent)
    // WHATWG URL parsing removes literal dot segments before exposing `pathname`; inspect the raw
    // path first so accepting a repository-root descriptor does not turn traversal into a valid ref.
    if (rawSegments.some(invalidPathPart)) return null
    // Decoding belongs inside the guard: `new URL` accepts a lone `%`, but decoding one throws, and
    // callers rely on invalid input returning null rather than raising mid-render.
    segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const [owner, rawRepo, ...tail] = segments
  // `tree` denotes a directory. GitHub's Raw action uses `/raw/refs/heads/...` and redirects to the
  // raw-content host, so both file routes belong to the same syntax contract.
  const rawRefAndPath =
    host === 'github.com' && (tail[0] === 'blob' || tail[0] === 'raw')
      ? tail.slice(1)
      : host === 'raw.githubusercontent.com'
        ? tail
        : null
  if (!rawRefAndPath) return null

  const repo = rawRepo?.replace(/\.git$/i, '')
  const fileName = rawRefAndPath.at(-1)
  const descriptorFileName = fileName === 'SKILL.md' || fileName === 'skill.md' ? fileName : null
  let refAndPath = rawRefAndPath.slice(0, -1)
  let refNamespace: GithubSkillLocation['refNamespace'] = null

  if (refAndPath[0] === 'refs' && (refAndPath[1] === 'heads' || refAndPath[1] === 'tags')) {
    refNamespace = refAndPath[1]
    refAndPath = refAndPath.slice(2)
  }

  if (!owner || !repo || !descriptorFileName) return null
  if (![owner, repo].every((part) => GITHUB_REPO_PART.test(part))) return null
  // A single segment can be a ref selecting a descriptor at the repository root.
  if (refAndPath.length < 1 || refAndPath.some(invalidPathPart)) return null

  return { owner, repo, refNamespace, refAndPath, descriptorFileName }
}

/** Present a validated GitHub SKILL.md URL as an installable search result. */
export function buildGithubSkillResult(rawUrl: string): SkillSearchResult | null {
  const location = parseGithubSkillUrl(rawUrl)
  if (!location) return null

  const { owner, repo, refNamespace, refAndPath, descriptorFileName } = location
  const path = encodeGithubPath(refAndPath.join('/'))
  const canonicalUrl = refNamespace
    ? `https://raw.githubusercontent.com/${owner}/${repo}/refs/${refNamespace}/${path}/${descriptorFileName}`
    : `https://github.com/${owner}/${repo}/blob/${path}/${descriptorFileName}`
  return {
    slug: `${owner}/${repo}/${refNamespace ? `refs/${refNamespace}/` : ''}${refAndPath.join('/')}`,
    name: repo,
    description: null,
    author: owner,
    stars: 0,
    downloads: 0,
    sourceRegistry: 'github',
    sourceUrl: canonicalUrl,
    installSource: `github:${canonicalUrl}`
  }
}

export function normalizeSkillsSh(raw: unknown): SkillSearchResult[] {
  const parsed = SkillsShSearchResponseSchema.safeParse(raw)
  if (!parsed.success) throw new Error('Invalid skills.sh search response')

  return parsed.data.skills.map((skill) => ({
    slug: skill.id,
    name: skill.name,
    description: null,
    author: skill.source.split('/')[0] ?? null,
    stars: 0,
    downloads: skill.installs,
    sourceRegistry: 'skills.sh',
    sourceUrl: `https://skills.sh/${skill.id}`,
    installSource: `skills.sh:${skill.id}`
  }))
}

export function normalizeClawhub(raw: unknown): SkillSearchResult[] {
  const parsed = ClawhubSearchResponseSchema.safeParse(raw)
  if (!parsed.success) throw new Error('Invalid clawhub.ai search response')

  return parsed.data.results.flatMap((skill) => {
    if (!skill.ownerHandle) return []

    return {
      slug: skill.slug,
      name: skill.displayName,
      description: skill.summary ?? null,
      author: skill.ownerHandle,
      stars: 0,
      downloads: 0,
      sourceRegistry: 'clawhub.ai' as const,
      sourceUrl: `https://clawhub.ai/${skill.ownerHandle}/skills/${skill.slug}`,
      installSource: `clawhub:${skill.ownerHandle}/${skill.slug}`
    }
  })
}

const MARKETPLACE_SOURCES: readonly MarketplaceSource[] = [
  {
    name: 'skills.sh',
    buildUrl: (query) => {
      const url = new URL('https://skills.sh/api/search')
      url.searchParams.set('q', query)
      return url.toString()
    },
    normalize: normalizeSkillsSh
  },
  {
    name: 'claude-plugins.dev',
    buildUrl: (query) => {
      const url = new URL('https://claude-plugins.dev/api/skills')
      url.searchParams.set('q', query)
      url.searchParams.set('limit', '20')
      return url.toString()
    },
    normalize: normalizeClaudePlugins
  },
  {
    name: 'clawhub.ai',
    buildUrl: (query) => {
      const url = new URL('https://clawhub.ai/api/v1/search')
      url.searchParams.set('q', query)
      return url.toString()
    },
    normalize: normalizeClawhub
  }
]

/**
 * Search every supported registry with caller-provided transport.
 * Partial failures are preserved; only an all-source failure rejects.
 */
export async function searchSkillMarketplaces(
  query: string,
  fetchJson: (url: string) => Promise<unknown>,
  onSourceFailure?: (source: SkillSearchSource, error: unknown) => void
): Promise<SkillSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const settled = await Promise.allSettled(
    MARKETPLACE_SOURCES.map(async (source) => source.normalize(await fetchJson(source.buildUrl(trimmed))))
  )
  const combined: SkillSearchResult[] = []
  let failedSourceCount = 0

  for (const [index, result] of settled.entries()) {
    if (result.status === 'fulfilled') {
      combined.push(...result.value)
    } else {
      failedSourceCount += 1
      onSourceFailure?.(MARKETPLACE_SOURCES[index].name, result.reason)
    }
  }

  if (failedSourceCount === MARKETPLACE_SOURCES.length) {
    throw new Error(SKILL_SEARCH_FAILED_ERROR)
  }

  const seen = new Set<string>()
  return combined.filter((result) => {
    const key = result.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
