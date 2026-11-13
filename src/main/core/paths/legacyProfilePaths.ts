import path from 'node:path'

/** Paths within a recorded legacy profile, which may be outside the active userData directory. */
export function getLegacyProfilePaths(userData: string) {
  return {
    database: path.join(userData, 'Data', 'cherrystudio.sqlite'),
    version: path.join(userData, 'version.log'),
    indexedDb: path.join(userData, 'IndexedDB'),
    localStorage: path.join(userData, 'Local Storage'),
    config: path.join(userData, 'config.json')
  }
}
