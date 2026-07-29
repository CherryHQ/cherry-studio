import path from 'node:path'

/**
 * Agent runtime config contains a generated projection of the managed skill
 * library. The library itself is authoritative under `feature.agents.skills`;
 * transporting this mirror would duplicate it and would also encounter POSIX
 * symlinks that portable capture deliberately refuses to follow.
 */
export function isAgentRuntimeConfigCaptureExcluded(relativePath: string): boolean {
  return relativePath === 'skills' || relativePath.startsWith('skills/')
}

function isContainedIn(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

/** Shared owner rule: a resolved workspace entry points into Cherry's canonical skill library. */
export function isManagedSkillTarget(resolvedTargetPath: string, managedSkillsRoot: string): boolean {
  return isContainedIn(managedSkillsRoot, resolvedTargetPath)
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
  const targetRelative = path.relative(path.resolve(managedSkillsRoot), path.resolve(resolvedTargetPath))
  const targetSegments = targetRelative.split(path.sep)
  const sameFolderName =
    process.platform === 'win32'
      ? targetSegments[0]?.toLocaleLowerCase('en-US') === segments[2]?.toLocaleLowerCase('en-US')
      : targetSegments[0] === segments[2]
  return (
    segments.length === 3 &&
    segments[0] === '.claude' &&
    segments[1] === 'skills' &&
    segments[2].length > 0 &&
    targetSegments.length === 1 &&
    targetRelative !== '' &&
    !targetRelative.startsWith(`..${path.sep}`) &&
    targetRelative !== '..' &&
    !path.isAbsolute(targetRelative) &&
    sameFolderName
  )
}
