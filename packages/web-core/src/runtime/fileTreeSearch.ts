// Browser `services/file/tree/search`: the desktop lists a directory tree with ripgrep, which the
// browser cannot run, so this walks it with ZenFS. The tree builder applies `.gitignore` itself.
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import type { AbsoluteFilePath, DirectoryListOptions } from '@shared/types/file'

/** Never descended into, as ripgrep's default globs skip them; the builder hides them anyway. */
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules'])

/** Lists a directory's entries as absolute paths, like the desktop's list mode (no `searchPattern`). */
export async function listDirectory(
  dirPath: AbsoluteFilePath | string,
  options: DirectoryListOptions = {}
): Promise<string[]> {
  const {
    recursive = true,
    maxDepth = 10,
    includeHidden = false,
    includeFiles = true,
    includeDirectories = true,
    maxEntries = Number.MAX_SAFE_INTEGER
  } = options
  if (!(await stat(dirPath)).isDirectory()) throw new Error(`Path is not a directory: ${dirPath}`)
  const depthLimit = !recursive ? 1 : maxDepth > 0 ? maxDepth : Infinity

  const paths: string[] = []
  const walk = async (directory: string, depth: number) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (paths.length >= maxEntries) return
      if (!includeHidden && entry.name.startsWith('.')) continue
      const entryPath = path.posix.join(directory, entry.name)
      if (!entry.isDirectory()) {
        if (includeFiles) paths.push(entryPath)
        continue
      }
      if (includeDirectories) paths.push(entryPath)
      if (depth < depthLimit && !SKIPPED_DIRECTORIES.has(entry.name)) await walk(entryPath, depth + 1)
    }
  }
  await walk(dirPath, 1)
  return paths.slice(0, maxEntries)
}
