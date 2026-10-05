import { createHash } from 'node:crypto'
import fs, { constants, createReadStream } from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { copyDirectoryRecursive } from '@main/utils/fileOperations'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { notesRelocationErrorCodes } from '@shared/ipc/errors/notesRelocation'
import type { NotesRelocationInspection, NotesRelocationResult } from '@shared/types/notesRelocation'

import { scanNotesDirectory } from './stats'
import { assertNotesRelocationPaths, NotesRelocationValidationError } from './validation'

const logger = loggerService.withContext('NotesRelocation')

async function assertNonMergeDestinationAbsent(destinationPath: string): Promise<void> {
  try {
    await fs.promises.lstat(destinationPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }

  throw new IpcError(
    notesRelocationErrorCodes.NOTES_RELOCATION_TARGET_NOT_EMPTY,
    'target entry appeared during migration'
  )
}

async function digestFile(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

export async function inspectNotesRelocation(
  sourcePath: string,
  targetPath: string
): Promise<NotesRelocationInspection> {
  try {
    await assertNotesRelocationPaths(sourcePath, targetPath)
    const [source, target] = await Promise.all([scanNotesDirectory(sourcePath), scanNotesDirectory(targetPath)])
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

async function listMergePathConflicts(sourceRoot: string, targetRoot: string): Promise<string[]> {
  const conflicts: string[] = []

  const walk = async (currentSource: string, relativePrefix: string): Promise<void> => {
    const entries = await fs.promises.readdir(currentSource, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue
      }
      const relativePath = relativePrefix ? path.join(relativePrefix, entry.name) : entry.name
      const sourceEntryPath = path.join(currentSource, entry.name)
      const targetEntryPath = path.join(targetRoot, relativePath)

      if (entry.isDirectory()) {
        await walk(sourceEntryPath, relativePath)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      const targetEntry = await fs.promises.lstat(targetEntryPath).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return undefined
        }
        throw error
      })
      if (!targetEntry) {
        continue
      }
      if (targetEntry.isSymbolicLink() || !targetEntry.isFile()) {
        conflicts.push(relativePath)
        continue
      }

      const sourceSize = (await fs.promises.stat(sourceEntryPath)).size
      if (targetEntry.size !== sourceSize) {
        conflicts.push(relativePath)
        continue
      }

      const [sourceDigest, targetDigest] = await Promise.all([digestFile(sourceEntryPath), digestFile(targetEntryPath)])
      if (sourceDigest !== targetDigest) {
        conflicts.push(relativePath)
      }
    }
  }

  await walk(sourceRoot, '')
  return conflicts
}

async function verifySourceCopied(sourceRoot: string, targetRoot: string): Promise<void> {
  const unresolved: string[] = []

  const walk = async (currentSource: string, relativePrefix: string): Promise<void> => {
    const entries = await fs.promises.readdir(currentSource, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue
      }
      const relativePath = relativePrefix ? path.join(relativePrefix, entry.name) : entry.name
      const sourceEntryPath = path.join(currentSource, entry.name)
      const targetEntryPath = path.join(targetRoot, relativePath)

      if (entry.isDirectory()) {
        try {
          const stats = await fs.promises.stat(targetEntryPath)
          if (!stats.isDirectory()) {
            unresolved.push(relativePath)
            continue
          }
        } catch {
          unresolved.push(relativePath)
          continue
        }
        await walk(sourceEntryPath, relativePath)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      const sourceSize = (await fs.promises.stat(sourceEntryPath)).size
      try {
        const targetSize = (await fs.promises.stat(targetEntryPath)).size
        if (targetSize !== sourceSize) {
          unresolved.push(relativePath)
        }
      } catch {
        unresolved.push(relativePath)
      }
    }
  }

  await walk(sourceRoot, '')

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
  options: { merge: boolean }
): Promise<NotesRelocationResult> {
  const inspection = await inspectNotesRelocation(sourcePath, targetPath)
  if (!inspection.valid) {
    throw new IpcError(notesRelocationErrorCodes.NOTES_RELOCATION_INVALID, inspection.reason)
  }

  if (!options.merge && inspection.targetHasFiles) {
    throw new IpcError(notesRelocationErrorCodes.NOTES_RELOCATION_TARGET_NOT_EMPTY, 'target already contains files')
  }

  const source = inspection.source

  const resolvedSource = path.resolve(sourcePath)
  const resolvedTarget = path.resolve(targetPath)
  const entries = await fs.promises.readdir(resolvedSource, { withFileTypes: true })

  if (options.merge) {
    const conflicts = await listMergePathConflicts(resolvedSource, resolvedTarget)
    if (conflicts.length > 0) {
      throw new IpcError(
        notesRelocationErrorCodes.NOTES_RELOCATION_MERGE_CONFLICT,
        `target already has ${conflicts.length} conflicting entries`
      )
    }
  }

  const copyOptions = options.merge ? { skipExistingFiles: true as const } : { exclusiveFileCopies: true as const }

  try {
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue
      }
      const from = path.join(resolvedSource, entry.name)
      const to = path.join(resolvedTarget, entry.name)
      if (entry.isDirectory()) {
        if (!options.merge) {
          await assertNonMergeDestinationAbsent(to)
        }
        await copyDirectoryRecursive(from, to, copyOptions)
        continue
      }
      if (!entry.isFile()) {
        continue
      }
      const targetEntry = await fs.promises.lstat(to).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return undefined
        }
        throw error
      })
      if (targetEntry?.isSymbolicLink()) {
        throw new IpcError(notesRelocationErrorCodes.NOTES_RELOCATION_INVALID, 'target contains a symlink')
      }
      if (targetEntry && copyOptions?.skipExistingFiles) {
        continue
      }
      if (!options.merge) {
        await assertNonMergeDestinationAbsent(to)
        try {
          await fs.promises.copyFile(from, to, constants.COPYFILE_EXCL)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new IpcError(
              notesRelocationErrorCodes.NOTES_RELOCATION_TARGET_NOT_EMPTY,
              'target entry appeared during migration'
            )
          }
          throw error
        }
        continue
      }
      await assertNonMergeDestinationAbsent(to)
      try {
        await fs.promises.copyFile(from, to, constants.COPYFILE_EXCL)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new IpcError(
            notesRelocationErrorCodes.NOTES_RELOCATION_TARGET_NOT_EMPTY,
            'target entry appeared during migration'
          )
        }
        throw error
      }
    }

    await verifySourceCopied(resolvedSource, resolvedTarget)
    const targetAfter = await scanNotesDirectory(resolvedTarget)

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
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new IpcError(
        notesRelocationErrorCodes.NOTES_RELOCATION_TARGET_NOT_EMPTY,
        'target entry appeared during migration'
      )
    }
    throw new IpcError(notesRelocationErrorCodes.NOTES_RELOCATION_FAILED, (error as Error).message)
  }
}
