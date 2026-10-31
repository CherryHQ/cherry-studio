// Browser stand-in for `@main/core/platform`: no desktop OS applies inside the Worker.
export const isMac = false
export const isWin = false
export const isLinux = false
export const isLinuxWayland = false
export const isDev = import.meta.env.DEV
export const isPortable = false
export const isDarwinX64 = false
export const isWinArm64 = false
