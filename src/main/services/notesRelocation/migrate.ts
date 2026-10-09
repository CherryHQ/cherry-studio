import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { copyDirectoryRecursive } from '@main/utils/fileOperations'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { notesRelocationErrorCodes } from '@shared/ipc/errors/notesRelocation'
import type { NotesRelocationInspection, NotesRelocationResult } from '@shared/types/notesRelocation'

import { assertNotesRelocationSourceStillCurrent } from './configuredSource'
import { scanNotesDirectory } from './stats'
import { assertNotesRelocationPaths, NotesRelocationValidationError, realPath } from './validation'

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
      targetHasFiles: target.fileCount > 0,
      sourceRealPath: realPath(sourcePath)
    }
  } catch (error) {
    if (error instanceof NotesRelocationValidationError) {
      return { valid: false, reason: error.reason }
    }
    throw error
  }
}

function listMergePathConflicts(sourceRoot: string, targetRoot: string): string[] {
  const conflicts: string[] = []

  const walk = (currentSource: string, relativePrefix: string) => {
    for (const entry of fs.readdirSync(currentSource, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        continue
      }
      const relativePath = relativePrefix ? path.join(relativePrefix, entry.name) : entry.name
      const sourceEntryPath = path.join(currentSource, entry.name)
      const targetEntryPath = path.join(targetRoot, relativePath)

      if (entry.isDirectory()) {
        walk(sourceEntryPath, relativePath)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      let targetEntry: fs.Stats
      try {
        targetEntry = fs.lstatSync(targetEntryPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          continue
        }
        throw error
      }
      if (targetEntry.isSymbolicLink()) {
        conflicts.push(relativePath)
        continue
      }
      if (!targetEntry.isFile()) {
        conflicts.push(relativePath)
        continue
      }

      const sourceSize = fs.statSync(sourceEntryPath).size
      if (targetEntry.size !== sourceSize) {
        conflicts.push(relativePath)
        continue
      }

      const sourceDigest = crypto.createHash('sha256').update(fs.readFileSync(sourceEntryPath)).digest()
      const targetDigest = crypto.createHash('sha256').update(fs.readFileSync(targetEntryPath)).digest()
      if (!crypto.timingSafeEqual(sourceDigest, targetDigest)) {
        conflicts.push(relativePath)
      }
    }
  }

  walk(sourceRoot, '')
  return conflicts
}

function verifySourceCopied(sourceRoot: string, targetRoot: string): void {
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
      let targetEntry: fs.Stats
      try {
        targetEntry = fs.lstatSync(targetEntryPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          unresolved.push(relativePath)
          continue
        }
        throw error
      }
      if (targetEntry.isSymbolicLink() || !targetEntry.isFile()) {
        unresolved.push(relativePath)
        continue
      }
      if (targetEntry.size !== sourceSize) {
        unresolved.push(relativePath)
      }
    }
  }

  walk(sourceRoot, '')

  if (unresolved.length > 0) {
    throw new IpcError(
      notesRelocationErrorCodes.NOTES_RELOCATION_VERIFY_FAILED,
      `failed to verify ${unresolved.length} migrated entries`
    )
  }
}

export async function migrateNotesDirectory(
  sourcePath: string,
  targetPath: string,
  options: { merge: boolean; expectedSourceRealPath: string }
): Promise<NotesRelocationResult> {
  const inspection = inspectNotesRelocation(sourcePath, targetPath)
  if (!inspection.valid) {
    throw new IpcError(notesRelocationErrorCodes.NOTES_RELOCATION_INVALID, inspection.reason)
  }

  if (realPath(options.expectedSourceRealPath) !== inspection.sourceRealPath) {
    throw new IpcError(notesRelocationErrorCodes.NOTES_RELOCATION_INVALID, 'stale_source')
  }

  if (!options.merge && inspection.targetHasFiles) {
    throw new IpcError(notesRelocationErrorCodes.NOTES_RELOCATION_TARGET_NOT_EMPTY, 'target already contains files')
  }

  const source = inspection.source

  const resolvedSource = realPath(sourcePath)
  const resolvedTarget = realPath(targetPath)

  try {
    assertNotesRelocationSourceStillCurrent(resolvedSource, options.expectedSourceRealPath)
  } catch {
    throw new IpcError(notesRelocationErrorCodes.NOTES_RELOCATION_INVALID, 'stale_source')
  }

  // Anchor the copy to the physical location validation evaluates: a symlinked
  // target root or ancestor would otherwise redirect writes outside the
  // selected target. Re-checking also closes the inspection→copy swap window.
  try {
    assertNotesRelocationPaths(resolvedSource, resolvedTarget)
  } catch (error) {
    if (error instanceof NotesRelocationValidationError) {
      throw new IpcError(notesRelocationErrorCodes.NOTES_RELOCATION_INVALID, error.message)
    }
    throw error
  }

  const entries = fs.readdirSync(resolvedSource, { withFileTypes: true })

  if (options.merge) {
    const conflicts = listMergePathConflicts(resolvedSource, resolvedTarget)
    if (conflicts.length > 0) {
      throw new IpcError(
        notesRelocationErrorCodes.NOTES_RELOCATION_MERGE_CONFLICT,
        `target already has ${conflicts.length} conflicting entries`
      )
    }
  } else {
    const targetBeforeCopy = scanNotesDirectory(resolvedTarget)
    if (targetBeforeCopy.fileCount > 0) {
      throw new IpcError(notesRelocationErrorCodes.NOTES_RELOCATION_TARGET_NOT_EMPTY, 'target already contains files')
    }
  }

  const copyOptions = options.merge
    ? { skipExistingFiles: true as const }
    : { failOnExistingDestination: true as const }

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
            throw new IpcError(notesRelocationErrorCodes.NOTES_RELOCATION_INVALID, 'target contains a symlink')
          }
          if (copyOptions?.skipExistingFiles) {
            continue
          }
          if (copyOptions?.failOnExistingDestination) {
            throw new IpcError(
              notesRelocationErrorCodes.NOTES_RELOCATION_TARGET_NOT_EMPTY,
              'target already contains files'
            )
          }
        }
        const copyFlags = copyOptions?.failOnExistingDestination ? fs.constants.COPYFILE_EXCL : 0
        try {
          await fs.promises.copyFile(from, to, copyFlags)
        } catch (error) {
          if (copyOptions?.failOnExistingDestination && (error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new IpcError(
              notesRelocationErrorCodes.NOTES_RELOCATION_TARGET_NOT_EMPTY,
              'target already contains files'
            )
          }
          throw error
        }
      }
    }

    verifySourceCopied(resolvedSource, resolvedTarget)
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
    const message = (error as Error).message
    if (message.includes('Destination file already exists')) {
      throw new IpcError(notesRelocationErrorCodes.NOTES_RELOCATION_TARGET_NOT_EMPTY, 'target already contains files')
    }
    throw new IpcError(notesRelocationErrorCodes.NOTES_RELOCATION_FAILED, message)
  }
}
