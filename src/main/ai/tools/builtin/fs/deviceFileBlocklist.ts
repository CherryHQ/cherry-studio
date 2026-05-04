/**
 * Device-file blocklist. Reject paths that point at kernel-exposed
 * pseudo-filesystems before we read them — opening these can leak host
 * state, lock the agent (e.g. reading `/dev/random` until EOF), or
 * cause undefined behaviour on `fs.readFile`.
 *
 * The dispatcher in `readFile.ts` calls this twice per request:
 *
 *   1. **Pre-realpath**, against the raw input. Catches Linux-shape
 *      paths like `/proc/self/cmdline` even on dev hosts (macOS) where
 *      `fs.realpath` fails with ENOENT and we'd otherwise return
 *      `not-found` instead of `device-file`. Also catches typos like
 *      `/dev/null/foo` before they're paid for in `realpath` syscalls.
 *
 *   2. **Post-realpath**, against the resolved path. Catches symlinks
 *      that resolve into a pseudo-fs (e.g. `/tmp/innocent → /dev/null`).
 *      A pre-realpath-only check would silently let these through.
 *
 * Both calls are load-bearing — collapsing to one is a security
 * regression. `/run/` matters for Linux container surfaces (Docker
 * sockets, secrets tmpfs); `/dev`, `/proc`, `/sys` matter everywhere.
 */

const BLOCKED_PREFIXES = ['/dev/', '/proc/', '/sys/', '/run/']
const BLOCKED_EXACT = new Set(['/dev', '/proc', '/sys', '/run'])

export function isDevicePath(absoluteRealPath: string): boolean {
  if (BLOCKED_EXACT.has(absoluteRealPath)) return true
  return BLOCKED_PREFIXES.some((p) => absoluteRealPath.startsWith(p))
}
