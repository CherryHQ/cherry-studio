/**
 * Minimum Windows version contract for Cherry Studio.
 *
 * Single source of truth for "which Windows releases are supported".
 * Electron 23+ (this repo uses Electron 45) no longer boots on Windows 7/8/8.1,
 * so the supported floor is Windows 10 1809 (build 17763, 64-bit x64/arm64)
 * including Windows 11 (build 22000+). Windows 7/8/8.1 releases — including
 * launches through third-party compatibility layers — are unsupported.
 *
 * `os.release()` reports the NT kernel version:
 *   Win7      -> "6.1.7601"
 *   Win8      -> "6.2.9200"
 *   Win8.1    -> "6.3.9600"
 *   Win10/11  -> "10.0.<build>" (1809 = 17763, 21H2 = 19044, Win11 21H2 = 22000)
 */

export const MIN_SUPPORTED_WINDOWS_BUILD = 17763

export const MIN_SUPPORTED_WINDOWS_VERSION_LABEL = 'Windows 10 1809'

export const MIN_SUPPORTED_WINDOWS_ARCH_LABEL = 'x64 / ARM64 (64-bit)'

/** Archival/GitHub releases page — referenced by installer/startup/docs copy. */
export const WINDOWS_SUPPORT_RELEASES_URL = 'https://github.com/CherryHQ/cherry-studio/releases'

export type WindowsReleaseInfo = {
  major: number | null
  minor: number | null
  build: number | null
}

/**
 * Parse an `os.release()` string into NT version parts.
 * Returns null parts when the string is not a dotted numeric version.
 */
export function parseWindowsRelease(osRelease: string): WindowsReleaseInfo {
  const parts = osRelease
    .trim()
    .split('.')
    .map((part) => Number.parseInt(part, 10))
  if (parts.length < 2 || parts.some((part) => !Number.isFinite(part) || part < 0)) {
    return { major: null, minor: null, build: null }
  }
  return {
    major: parts[0],
    minor: parts[1],
    build: parts.length >= 3 && Number.isFinite(parts[2]) ? parts[2] : null
  }
}

/**
 * Whether an `os.release()` value meets the minimum supported Windows version.
 *
 * Non-Windows platforms always return true — this gate is Windows-only.
 * Unparseable values fail open (true) so an unknown future kernel never bricks
 * a supported machine; callers should log a warning in that case.
 */
export function isSupportedWindowsRelease(osRelease: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return true
  const { major, build } = parseWindowsRelease(osRelease)
  if (major === null) return true
  if (major > 10) return true
  if (major < 10) return false
  // major === 10 covers both Windows 10 and Windows 11 (both report 10.0.*).
  if (build === null) return true
  return build >= MIN_SUPPORTED_WINDOWS_BUILD
}

/** True for the legacy NT 6.x line (Vista/7/8/8.1) — always unsupported. */
export function isLegacyWindowsRelease(osRelease: string): boolean {
  const { major } = parseWindowsRelease(osRelease)
  return major !== null && major < 10
}
