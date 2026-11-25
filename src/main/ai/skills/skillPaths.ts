import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { foldPathSegment } from '@main/utils/file'
import { deleteDirectoryRecursive } from '@main/utils/fileOperations'

const logger = loggerService.withContext('SkillPaths')

const MAX_FOLDER_NAME_LENGTH = 80
const HASH_SUFFIX_LENGTH = 8
const WINDOWS_RESERVED_FOLDER_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

const shortHash = (input: string): string =>
  createHash('sha256').update(input).digest('hex').slice(0, HASH_SUFFIX_LENGTH)

// Compared case-insensitively: Windows reserves these device names in every directory.
const WINDOWS_RESERVED_FOLDER_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9'
])

export function sanitizeFolderName(folderName: string): string {
  const normalized = folderName.normalize('NFC').trim()
  let sanitized = normalized
    .replace(/\0/g, '')
    .replace(/[^\p{L}\p{M}\p{N}_-]/gu, '_')
    .replace(/^\p{M}+/u, '')

  if (!/[\p{L}\p{N}]/u.test(sanitized)) {
    if (!normalized) return ''
    return `skill-${shortHash(normalized)}`
  }

  const codePoints = Array.from(sanitized)
  if (codePoints.length > MAX_FOLDER_NAME_LENGTH) {
    const prefixLength = MAX_FOLDER_NAME_LENGTH - HASH_SUFFIX_LENGTH - 1
    sanitized = `${codePoints.slice(0, prefixLength).join('')}-${shortHash(normalized)}`
  }

  if (WINDOWS_RESERVED_FOLDER_NAME.test(sanitized)) {
    sanitized = `${sanitized}-skill`
  }

  // Windows refuses to create directories named after reserved device names, so such a skill
  // would fail to install. Suffix them; the names cannot work as folders on Windows as-is.
  if (WINDOWS_RESERVED_FOLDER_NAMES.has(sanitized.toLowerCase())) {
    sanitized = `${sanitized}-skill`
  }

  return sanitized
}

/** Case- and Unicode-folding key for folder names so platform-equivalent names match. */
export function normalizeFolderKey(folderName: string): string {
  return foldPathSegment(folderName)
}

const RESERVED_FOLDER_NAME_SUFFIX = '-skill'

/** Stored stem of a suffixed derivation (`CON-skill` → `CON`); null when the name is not one. */
export function reservedFolderNameStem(folderName: string): string | null {
  if (!folderName.endsWith(RESERVED_FOLDER_NAME_SUFFIX)) return null
  const stem = folderName.slice(0, -RESERVED_FOLDER_NAME_SUFFIX.length)
  return WINDOWS_RESERVED_FOLDER_NAMES.has(stem.toLowerCase()) ? stem : null
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
