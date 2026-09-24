export interface RemoteRef {
  name: string
  sha: string
}

export interface ResolvedRef {
  kind: 'branch' | 'tag'
  name: string
  ref: string
  sha: string
}

export function parseRemoteRefs(output: string): RemoteRef[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, name] = line.split(/\s+/, 2)
      if (!sha || !name) throw new Error(`Invalid ls-remote output: ${line}`)
      return { name, sha }
    })
}

export function resolveTrustedRef(requestedRef: string, remoteRefs: RemoteRef[]): ResolvedRef {
  const requested = requestedRef.trim()
  if (!requested) throw new Error('Ref is required')

  const explicitKind = requested.startsWith('refs/heads/')
    ? 'branch'
    : requested.startsWith('refs/tags/')
      ? 'tag'
      : undefined
  const plainName = explicitKind ? requested.replace(/^refs\/(heads|tags)\//, '') : requested
  const branchRef = `refs/heads/${plainName}`
  const tagRef = `refs/tags/${plainName}`
  const branch = remoteRefs.find(({ name }) => name === branchRef)
  const tag = remoteRefs.find(({ name }) => name === tagRef)

  if (!explicitKind && branch && tag) {
    throw new Error(`Ref is ambiguous; use refs/heads/... or refs/tags/...: ${requested}`)
  }

  const kind = explicitKind ?? (branch ? 'branch' : tag ? 'tag' : undefined)
  const matched = kind === 'branch' ? branch : kind === 'tag' ? tag : undefined
  if (!kind || !matched) throw new Error(`Ref not found: ${requested}`)

  if (kind === 'branch' && plainName !== 'main' && !plainName.startsWith('release/')) {
    throw new Error('Only main, release/* branches, and v* tags are trusted')
  }
  if (kind === 'tag' && !plainName.startsWith('v')) {
    throw new Error('Only main, release/* branches, and v* tags are trusted')
  }

  const peeled = kind === 'tag' ? remoteRefs.find(({ name }) => name === `${tagRef}^{}`) : undefined
  return {
    kind,
    name: plainName,
    ref: kind === 'branch' ? branchRef : tagRef,
    sha: peeled?.sha ?? matched.sha
  }
}
