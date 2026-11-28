const LOADER_PREFIXES = ['LD_', 'DYLD_']

/** FFmpeg child env. createEnv rejects LD_* / DYLD_*, so ambient loader paths are removed here. */
export function isolatedLinuxLoaderEnv(base: NodeJS.ProcessEnv, libDir: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (typeof value !== 'string') continue
    if (LOADER_PREFIXES.some((prefix) => key.toUpperCase().startsWith(prefix))) continue
    env[key] = value
  }
  env.LD_LIBRARY_PATH = libDir
  return env
}

export function mediaFfmpegCommandEnv(
  linuxLibraryDir: string | undefined,
  baseEnv: NodeJS.ProcessEnv
): NodeJS.ProcessEnv | undefined {
  if (!linuxLibraryDir) return undefined
  return isolatedLinuxLoaderEnv(baseEnv, linuxLibraryDir)
}
