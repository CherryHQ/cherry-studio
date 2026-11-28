import os from 'node:os'

export const isMac = process.platform === 'darwin'
export const isWin = process.platform === 'win32'
export const isLinux = process.platform === 'linux'
// Session type, not Chromium's ozone backend: a Wayland session forced onto X11 via --ozone-platform=x11 still reads true.
export const isLinuxWayland = isLinux && process.env.XDG_SESSION_TYPE === 'wayland'
export const isDev = process.env.NODE_ENV === 'development'
export const isPortable = isWin && 'PORTABLE_EXECUTABLE_DIR' in process.env
// onnxruntime-node ships no darwin-x64 binding (arm64 only) — gates local model
// inference (embedding + OCR) off on Intel Mac.
export const isDarwinX64 = isMac && process.arch === 'x64'
// @firecrawl/anydoc ships no win32-arm64 binding or wasm fallback.
export const isWinArm64 = isWin && process.arch === 'arm64'

/** Parse the leading integer major version from a dotted OS version string. */
export function parseOsMajorVersion(version?: string): number | undefined {
  if (!version) return undefined
  const major = Number.parseInt(version.split('.')[0] ?? '', 10)
  return Number.isInteger(major) ? major : undefined
}

/** True on Windows versions older than Windows 10 (e.g. Win 7 = 6.1, Win 8.1 = 6.3). */
export function isWindowsLegacy(systemVersion?: string): boolean {
  if (process.platform !== 'win32') return false
  const major = parseOsMajorVersion(systemVersion ?? (process.getSystemVersion?.() || os.release()))
  return major !== undefined && major < 10
}
