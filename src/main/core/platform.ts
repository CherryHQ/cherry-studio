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
