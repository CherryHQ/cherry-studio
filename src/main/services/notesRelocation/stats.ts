import fs from 'node:fs'
import path from 'node:path'

import type { NotesDirectoryStats } from '@shared/types/notesRelocation'

const MARKDOWN_EXT = '.md'

export async function scanNotesDirectory(dirPath: string): Promise<NotesDirectoryStats> {
  const stats: NotesDirectoryStats = {
    markdownFileCount: 0,
    fileCount: 0,
    folderCount: 0,
    totalBytes: 0
  }

  await walk(dirPath, stats)
  return stats
}

async function walk(currentPath: string, stats: NotesDirectoryStats): Promise<void> {
  const entries = await fs.promises.readdir(currentPath, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(currentPath, entry.name)
    if (entry.isSymbolicLink()) {
      continue
    }
    if (entry.isDirectory()) {
      stats.folderCount += 1
      await walk(entryPath, stats)
      continue
    }
    if (!entry.isFile()) {
      continue
    }
    stats.fileCount += 1
    const fileStats = await fs.promises.stat(entryPath)
    stats.totalBytes += fileStats.size
    if (entry.name.toLowerCase().endsWith(MARKDOWN_EXT)) {
      stats.markdownFileCount += 1
    }
  }
}
