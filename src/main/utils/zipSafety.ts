import path from 'node:path'

import { foldPathSegment } from '@main/utils/file'

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

/**
 * Reject archives whose entries collide once case and Unicode composition are folded.
 *
 * Such paths land on one file on Windows and default macOS volumes, so the extracted content would
 * depend on the platform and on which entry was written last. Colliding archives are rejected
 * rather than resolved: there is no correct entry to keep.
 *
 * @param subject - What holds the paths, named in the error (e.g. `Skill`, `MCP package`)
 * @throws Error naming the two colliding paths
 */
export function assertNoFoldedPathCollisions(paths: readonly string[], subject = 'Archive'): void {
  type PathNode = { part: string; children: Map<string, PathNode> }
  const root = new Map<string, PathNode>()

  // One node per directory level: an entry name can nest tens of thousands of levels deep, so
  // re-joining every prefix would block the main process for minutes.
  for (const entryPath of paths) {
    const parts = entryPath.split('/').filter(Boolean)
    let level = root
    for (const [index, part] of parts.entries()) {
      const key = foldPathSegment(part)
      let node = level.get(key)
      if (!node) {
        node = { part, children: new Map() }
        level.set(key, node)
      } else if (node.part !== part) {
        const parent = parts.slice(0, index).join('/')
        const [previous, current] = [node.part, part].map((name) => (parent ? `${parent}/${name}` : name))
        throw new Error(
          `${subject} contains paths that collide once case and Unicode are normalized (${previous}, ${current}).`
        )
      }
      level = node.children
    }
  }
}
