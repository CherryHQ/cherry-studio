export const isMac = process.platform === 'darwin'
export const isWin = process.platform === 'win32'
export const isLinux = process.platform === 'linux'
export const isDev = process.env.NODE_ENV === 'development'
export const isPortable = isWin && 'PORTABLE_EXECUTABLE_DIR' in process.env
// onnxruntime-node ships no darwin-x64 binding (arm64 only) — gates local model
// inference (embedding + OCR) off on Intel Mac.
export const isDarwinX64 = isMac && process.arch === 'x64'
