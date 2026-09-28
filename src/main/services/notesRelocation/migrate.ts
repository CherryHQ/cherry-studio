import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { copyDirectoryRecursive } from '@main/utils/fileOperations'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { NotesRelocationInspection, NotesRelocationResult } from '@shared/types/notesRelocation'

import { scanNotesDirectory } from './stats'
import { assertNotesRelocationPaths, NotesRelocationValidationError } from './validation'

const logger = loggerService.withContext('NotesRelocation')

export function inspectNotesRelocation(sourcePath: string, targetPath: string): NotesRelocationInspection {
  try {
    assertNotesRelocationPaths(sourcePath, targetPath)
    const source = scanNotesDirectory(sourcePath)
    const target = scanNotesDirectory(targetPath)
    return {
      valid: true,
      source,
      target,
      targetHasMarkdown: target.markdownFileCount > 0,
      targetHasFiles: target.fileCount > 0
    }
  } catch (error) {
    if (error instanceof NotesRelocationValidationError) {
      return { valid: false, reason: error.reason }
    }
    throw error
  }
}

function listRelativeFilePaths(root: string, relativePrefix = ''): string[] {
  const paths: string[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      continue
    }
    const relativePath = relativePrefix ? path.join(relativePrefix, entry.name) : entry.name
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      paths.push(...listRelativeFilePaths(entryPath, relativePath))
    } else if (entry.isFile()) {
      paths.push(relativePath)
    }
  }
  return paths
}

function verifySourceCopied(
  sourceRoot: string,
  targetRoot: string,
  options?: { skipExistingFiles?: boolean; preExistingRelativePaths?: Set<string> }
): void {
  const unresolved: string[] = []

  const walk = (currentSource: string, relativePrefix: string) => {
    for (const entry of fs.readdirSync(currentSource, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        continue
      }
      const relativePath = relativePrefix ? path.join(relativePrefix, entry.name) : entry.name
      const sourceEntryPath = path.join(currentSource, entry.name)
      const targetEntryPath = path.join(targetRoot, relativePath)

      if (entry.isDirectory()) {
        if (!fs.existsSync(targetEntryPath) || !fs.statSync(targetEntryPath).isDirectory()) {
          unresolved.push(relativePath)
          continue
        }
        walk(sourceEntryPath, relativePath)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      const sourceSize = fs.statSync(sourceEntryPath).size
      if (!fs.existsSync(targetEntryPath)) {
        unresolved.push(relativePath)
        continue
      }

      const targetSize = fs.statSync(targetEntryPath).size
      if (targetSize !== sourceSize) {
        if (options?.skipExistingFiles && options.preExistingRelativePaths?.has(relativePath)) {
          continue
        }
        unresolved.push(relativePath)
      }
    }
  }

  walk(sourceRoot, '')

  if (unresolved.length > 0) {
    throw new IpcError('NOTES_RELOCATION_VERIFY_FAILED', `failed to verify ${unresolved.length} migrated entries`)
  }
}

export async function migrateNotesDirectory(
  sourcePath: string,
  targetPath: string,
  options: { merge: boolean }
): Promise<NotesRelocationResult> {
  const inspection = inspectNotesRelocation(sourcePath, targetPath)
  if (!inspection.valid) {
    throw new IpcError('NOTES_RELOCATION_INVALID', inspection.reason)
  }

  if (!options.merge && inspection.targetHasFiles) {
    throw new IpcError('NOTES_RELOCATION_TARGET_NOT_EMPTY', 'target already contains files')
  }

  const source = inspection.source

  const resolvedSource = path.resolve(sourcePath)
  const resolvedTarget = path.resolve(targetPath)
  const entries = fs.readdirSync(resolvedSource, { withFileTypes: true })

  const preExistingRelativePaths = options.merge ? new Set(listRelativeFilePaths(resolvedTarget)) : undefined
  const copyOptions = options.merge ? { skipExistingFiles: true as const, preExistingRelativePaths } : undefined

  try {
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue
      }
      const from = path.join(resolvedSource, entry.name)
      const to = path.join(resolvedTarget, entry.name)
      if (entry.isDirectory()) {
        await copyDirectoryRecursive(from, to, copyOptions)
      } else if (entry.isFile()) {
        if (fs.existsSync(to)) {
          const targetEntry = fs.lstatSync(to)
          if (targetEntry.isSymbolicLink()) {
            throw new IpcError('NOTES_RELOCATION_INVALID', 'target contains a symlink')
          }
          if (copyOptions?.skipExistingFiles) {
            continue
          }
        }
        await fs.promises.copyFile(from, to)
      }
    }

    verifySourceCopied(resolvedSource, resolvedTarget, {
      skipExistingFiles: copyOptions?.skipExistingFiles,
      preExistingRelativePaths
    })
    const targetAfter = scanNotesDirectory(resolvedTarget)

    logger.info('Notes directory migrated', {
      from: resolvedSource,
      to: resolvedTarget,
      merge: options.merge,
      source,
      targetAfter
    })

    return { source, target: targetAfter }
  } catch (error) {
    logger.error('Notes directory migration failed', error as Error, {
      from: resolvedSource,
      to: resolvedTarget
    })
    if (error instanceof IpcError) {
      throw error
    }
    throw new IpcError('NOTES_RELOCATION_FAILED', (error as Error).message)
  }
}
