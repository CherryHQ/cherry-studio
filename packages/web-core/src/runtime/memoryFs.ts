// `node:fs` for the desktop CacheService only: its persist tier is a losable JSON file
// (`cache.json`). In the Worker that tier lives in memory for the session, so the file never exists.
function existsSync(): boolean {
  return false
}

function readFileSync(path: string): never {
  throw new Error(`${path} does not exist in the Web Core Worker`)
}

function noop(): void {}

export default { existsSync, readFileSync, writeFileSync: noop, renameSync: noop, rmSync: noop }
