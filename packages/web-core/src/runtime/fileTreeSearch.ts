// Browser `services/file/tree/search`: the desktop lists a directory tree with ripgrep, which the
// browser cannot run, so this walks it with ZenFS. The tree builder applies `.gitignore` itself.
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import { compareScoredSearchEntries, scoreFuzzyPaths } from '@main/services/file/tree/fuzzyScore'
import type { AbsoluteFilePath, DirectoryEntry, DirectoryListOptions } from '@shared/types/file'

/** Never descended into, as ripgrep's default globs skip them; the builder hides them anyway. */
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules'])

/**
 * Lists a directory's entries as absolute paths. With a `searchPattern` other than `.`, lists only the
 * paths that fuzzy-match it, best match first, as the desktop does.
 */
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
    maxEntries = Number.MAX_SAFE_INTEGER,
    searchPattern = '.'
  } = options
  if (!(await stat(dirPath)).isDirectory()) throw new Error(`Path is not a directory: ${dirPath}`)
  const depthLimit = !recursive ? 1 : maxDepth > 0 ? maxDepth : Infinity
  const searching = searchPattern !== '.'
  // A search scores every path before keeping the best ones.
  const walkLimit = searching ? Number.MAX_SAFE_INTEGER : maxEntries

  const paths: string[] = []
  const directories = new Set<string>()
  const walk = async (directory: string, depth: number) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (paths.length >= walkLimit) return
      if (!includeHidden && entry.name.startsWith('.')) continue
      const entryPath = path.posix.join(directory, entry.name)
      if (!entry.isDirectory()) {
        if (includeFiles) paths.push(entryPath)
        continue
      }
      if (includeDirectories) paths.push(entryPath)
      directories.add(entryPath)
      if (depth < depthLimit && !SKIPPED_DIRECTORIES.has(entry.name)) await walk(entryPath, depth + 1)
    }
  }
  await walk(dirPath, 1)
  if (!searching) return paths.slice(0, maxEntries)
  return [
    ...scoreFuzzyPaths(
      paths.filter((entryPath) => !directories.has(entryPath)),
      dirPath,
      searchPattern,
      false
    ),
    ...scoreFuzzyPaths(
      paths.filter((entryPath) => directories.has(entryPath)),
      dirPath,
      searchPattern,
      true
    )
  ]
    .sort(compareScoredSearchEntries)
    .slice(0, maxEntries)
    .map((entry) => entry.path)
}

/** Like {@link listDirectory}, but tells each entry's kind. */
export async function listDirectoryEntries(
  dirPath: AbsoluteFilePath | string,
  options?: DirectoryListOptions
): Promise<DirectoryEntry[]> {
  const entries = await Promise.all(
    (await listDirectory(dirPath, options)).map(async (entryPath) => {
      // An entry removed since it was listed is left out, as on the desktop.
      const entryStat = await stat(entryPath).catch(() => null)
      return entryStat && { path: entryPath as AbsoluteFilePath, isDirectory: entryStat.isDirectory() }
    })
  )
  return entries.filter((entry): entry is DirectoryEntry => entry !== null)
}
