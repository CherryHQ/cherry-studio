import path from 'node:path'

/** Both build configs write into the throwaway app the runner assembles. */
export function smokeAppDir(): string {
  const dir = process.env.UTILITY_PROCESS_SMOKE_APP_DIR
  if (dir === undefined || !path.isAbsolute(dir)) {
    throw new Error('UTILITY_PROCESS_SMOKE_APP_DIR must be an absolute path')
  }
  return dir
}
