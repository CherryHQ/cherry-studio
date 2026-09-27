import fs from 'node:fs'
import path from 'node:path'

import type { NotesDirectoryStats } from '@shared/types/notesRelocation'

const MARKDOWN_EXT = '.md'

export function scanNotesDirectory(dirPath: string): NotesDirectoryStats {
  const stats: NotesDirectoryStats = {
    markdownFileCount: 0,
    folderCount: 0,
    totalBytes: 0
  }

  walk(dirPath, stats)
  return stats
}

function walk(currentPath: string, stats: NotesDirectoryStats): void {
  const entries = fs.readdirSync(currentPath, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(currentPath, entry.name)
    if (entry.isSymbolicLink()) {
      continue
    }
    if (entry.isDirectory()) {
      stats.folderCount += 1
      walk(entryPath, stats)
      continue
    }
    if (!entry.isFile()) {
      continue
    }
    const fileStats = fs.statSync(entryPath)
    stats.totalBytes += fileStats.size
    if (entry.name.toLowerCase().endsWith(MARKDOWN_EXT)) {
      stats.markdownFileCount += 1
    }
  }
}
