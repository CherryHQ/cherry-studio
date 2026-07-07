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
