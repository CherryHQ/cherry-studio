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
