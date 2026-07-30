/**
 * Agent runtime config contains a generated projection of the managed skill
 * library. The canonical library is transported separately.
 */
export function isAgentRuntimeConfigCaptureExcluded(relativePath: string): boolean {
  return relativePath === 'skills' || relativePath.startsWith('skills/')
}

interface ParsedResolvedPath {
  root: string
  segments: string[]
  caseInsensitive: boolean
}

function parseResolvedPath(value: string): ParsedResolvedPath | null {
  const normalized = value.replaceAll('\\', '/')
  const drive = /^([a-zA-Z]:)\/(.*)$/.exec(normalized)
  if (drive) {
    const segments = parseSegments(drive[2])
    if (!segments) return null
    return {
      root: drive[1].toLocaleLowerCase('en-US'),
      segments,
      caseInsensitive: true
    }
  }

  if (normalized.startsWith('//')) {
    const segments = parseSegments(normalized.slice(2))
    if (!segments || segments.length < 2) return null
    return {
      root: `//${segments[0].toLocaleLowerCase('en-US')}/${segments[1].toLocaleLowerCase('en-US')}`,
      segments: segments.slice(2),
      caseInsensitive: true
    }
  }

  if (!normalized.startsWith('/')) return null
  const segments = parseSegments(normalized.slice(1))
  return segments ? { root: '/', segments, caseInsensitive: false } : null
}

function parseSegments(value: string): string[] | null {
  const segments = value.split('/').filter((segment) => segment.length > 0 && segment !== '.')
  return segments.includes('..') ? null : segments
}

function relativeManagedSegments(resolvedTargetPath: string, managedSkillsRoot: string): string[] | null {
  const target = parseResolvedPath(resolvedTargetPath)
  const root = parseResolvedPath(managedSkillsRoot)
  if (!target || !root || target.root !== root.root || target.caseInsensitive !== root.caseInsensitive) return null
  if (target.segments.length < root.segments.length) return null

  const normalize = (segment: string) => (root.caseInsensitive ? segment.toLocaleLowerCase('en-US') : segment)
  for (let index = 0; index < root.segments.length; index += 1) {
    if (normalize(target.segments[index]) !== normalize(root.segments[index])) return null
  }
  return target.segments.slice(root.segments.length)
}

/** Shared owner rule: a resolved workspace entry points into Cherry's canonical skill library. */
export function isManagedSkillTarget(resolvedTargetPath: string, managedSkillsRoot: string): boolean {
  return relativeManagedSegments(resolvedTargetPath, managedSkillsRoot) !== null
}

/**
 * Workspace-local `.claude/skills` entries are derived only when the node is a
 * direct skill projection whose target belongs to the canonical managed
 * library. The scanner proves the node is a link before asking this predicate.
 */
export function isWorkspaceManagedSkillProjection(
  relativePath: string,
  resolvedTargetPath: string,
  managedSkillsRoot: string
): boolean {
  const segments = relativePath.split('/')
  const targetSegments = relativeManagedSegments(resolvedTargetPath, managedSkillsRoot)
  const target = parseResolvedPath(resolvedTargetPath)
  const sameFolderName = target?.caseInsensitive
    ? targetSegments?.[0]?.toLocaleLowerCase('en-US') === segments[2]?.toLocaleLowerCase('en-US')
    : targetSegments?.[0] === segments[2]
  return (
    segments.length === 3 &&
    segments[0] === '.claude' &&
    segments[1] === 'skills' &&
    segments[2].length > 0 &&
    targetSegments?.length === 1 &&
    sameFolderName
  )
}
