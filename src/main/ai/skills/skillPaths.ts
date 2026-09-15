import * as fs from 'node:fs'
import * as path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { deleteDirectoryRecursive } from '@main/utils/fileOperations'
import type { SkillFileNode } from '@shared/types/skill'

const logger = loggerService.withContext('SkillPaths')

const MAX_FOLDER_NAME_LENGTH = 80

export function sanitizeFolderName(folderName: string): string {
  let sanitized = folderName.replace(/[/\\]/g, '_')
  sanitized = sanitized.replace(new RegExp(String.fromCharCode(0), 'g'), '')
  sanitized = sanitized.replace(/[^a-zA-Z0-9_-]/g, '_')

  if (sanitized.length > MAX_FOLDER_NAME_LENGTH) {
    sanitized = sanitized.slice(0, MAX_FOLDER_NAME_LENGTH)
  }

  return sanitized
}

/** Case-folding key for folder names, so a case-only difference never reads as two skills. */
export function normalizeFolderKey(folderName: string): string {
  return folderName.toLowerCase()
}

export async function createTempDir(prefix: string): Promise<string> {
  const root = application.getPath('feature.agents.skills.install.temp')
  await fs.promises.mkdir(root, { recursive: true })
  // mkdtemp, not a timestamp: two installs starting in the same millisecond would otherwise share
  // one workspace and delete each other's checkout on cleanup.
  return fs.promises.mkdtemp(path.join(root, `${prefix}-`))
}

export async function safeRemoveDirectory(dirPath: string): Promise<void> {
  try {
    await deleteDirectoryRecursive(dirPath)
  } catch (error) {
    logger.warn('Failed to clean up temp directory', {
      dirPath,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

export async function buildFileTree(dir: string, root: string): Promise<SkillFileNode[]> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true })
  const nodes: SkillFileNode[] = []

  const sorted = entries
    .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  for (const entry of sorted) {
    const fullPath = path.join(dir, entry.name)
    const relativePath = path.relative(root, fullPath)

    if (entry.isDirectory()) {
      const children = await buildFileTree(fullPath, root)
      nodes.push({ name: entry.name, path: relativePath, type: 'directory', children })
    } else {
      nodes.push({ name: entry.name, path: relativePath, type: 'file' })
    }
  }

  return nodes
}
