import path from 'node:path'

/**
 * Defense-in-depth zip-slip guard: node-stream-zip rejects malicious names at parse
 * time (`validateName`), but nothing at the extract() call boundary enforces
 * containment — this keeps the guarantee independent of lib internals or config
 * (`skipEntryNameValidation`). Nested subdirectories are allowed (archives
 * legitimately contain them).
 *
 * @throws Error if any entry name escapes `baseDir`
 */
export function assertZipEntriesWithin(entryNames: string[], baseDir: string): void {
  const root = path.resolve(baseDir)
  for (const name of entryNames) {
    const dest = path.resolve(baseDir, name)
    if (dest !== root && !dest.startsWith(root + path.sep)) {
      throw new Error(`Unsafe zip entry path (zip-slip): ${name}`)
    }
  }
}
