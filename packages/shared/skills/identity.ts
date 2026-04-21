function normalizeGitHubPath(directoryPath: string | null | undefined) {
  const raw = (directoryPath ?? '').trim().replace(/\\/g, '/')
  if (raw === '.' || raw === './') return ''
  return raw.replace(/^\/+|\/+$/g, '')
}

export function buildGithubOriginKey(
  owner: string | null | undefined,
  repo: string | null | undefined,
  directoryPath = ''
) {
  if (!owner || !repo) return null

  const normalizedPath = normalizeGitHubPath(directoryPath)
  return `github:${owner}/${repo}${normalizedPath ? `#${normalizedPath}` : ''}`
}

export function buildClawhubOriginKey(slug: string | null | undefined) {
  return slug ? `clawhub:${slug}` : null
}

/**
 * Derive a best-effort origin key from an installSource string.
 *
 * `installSource` remains the authoritative dedup key. This helper only
 * produces auxiliary metadata for cases where the source can express a useful
 * repo/slug identity without requiring extra lookups.
 */
export function installSourceToOriginKey(installSource: string | null | undefined) {
  if (!installSource) return null
  const colonIdx = installSource.indexOf(':')
  if (colonIdx < 0) return null

  const scheme = installSource.slice(0, colonIdx)
  const body = installSource.slice(colonIdx + 1)
  if (!body) return null

  if (scheme === 'clawhub') return buildClawhubOriginKey(body)
  if (scheme === 'claude-plugins' || scheme === 'skills.sh') {
    const [owner, repo, ...rest] = body.split('/')
    return buildGithubOriginKey(owner, repo, rest.join('/'))
  }
  return null
}
