export const platform = window.electron?.process?.platform
export const isMac = platform === 'darwin'
export const isWin = platform === 'win32' || platform === 'win64'
export const isLinux = platform === 'linux'
/** Wayland session: frameless windows can be transparent and still resize natively. */
export const isLinuxWayland = isLinux && window.electron?.process?.env?.XDG_SESSION_TYPE === 'wayland'
export const isDev = window.electron?.process?.env?.NODE_ENV === 'development'
export const isProd = window.electron?.process?.env?.NODE_ENV === 'production'
