/**
 * v1-compatible system-root directory guard.
 *
 * Source reference:
 * `v1:src/main/services/FileStorage.ts` rejected "system root directories" as:
 *   - Windows: drive roots such as `C:\`
 *   - POSIX: `/`, `/usr`, `/etc`, `/System`
 *
 * This shared version keeps the same policy but infers platform from path
 * shape so it can run in both renderer and preboot code.
 */
export function isProtectedSystemPath(candidate: string): boolean {
  if (!candidate || candidate.trim() === '') return false

  const normalized = candidate.replace(/\\/g, '/').replace(/\/+$/, '')

  if (/^[A-Za-z]:$/.test(normalized)) {
    return true
  }

  return (
    normalized === '' ||
    normalized === '/' ||
    normalized === '/usr' ||
    normalized === '/etc' ||
    normalized === '/System'
  )
}

export function getPathDepthForSafety(candidate: string): number {
  const normalized = candidate.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalized === '' || normalized === '/') return 0

  const driveTrimmed = normalized.replace(/^[A-Za-z]:\/?/, '')
  if (driveTrimmed === '') return 0

  if (driveTrimmed.startsWith('//')) {
    const uncParts = driveTrimmed.split('/').filter(Boolean)
    return Math.max(0, uncParts.length - 2)
  }

  return driveTrimmed.split('/').filter(Boolean).length
}

export function isRootOrTopLevelPath(candidate: string): boolean {
  if (!candidate || candidate.trim() === '') return false
  return getPathDepthForSafety(candidate) <= 1
}

/**
 * Stricter relocation target guard.
 *
 * The v1-compatible guard above intentionally matches only exact roots.
 * Relocation can recursively replace the selected target, so it must also
 * reject descendants of known OS/application roots.
 */
export function isProtectedSystemPathOrDescendant(candidate: string): boolean {
  if (!candidate || candidate.trim() === '') return false

  const normalized = candidate.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalized === '') return true
  if (isProtectedSystemPath(normalized)) return true

  const lower = normalized.toLowerCase()
  const protectedPrefixes = [
    '/usr/',
    '/etc/',
    '/system/',
    '/bin/',
    '/sbin/',
    '/var/',
    '/library/',
    '/applications/',
    '/opt/',
    'c:/windows/',
    'c:/program files/',
    'c:/program files (x86)/'
  ]

  return protectedPrefixes.some((prefix) => lower.startsWith(prefix))
}
