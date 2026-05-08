import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { loggerService } from '@logger'
import { pathExists } from '@main/utils/file'
import StreamZip from 'node-stream-zip'

export const OUTPUT_MARKDOWN_FILE = 'output.md'
const logger = loggerService.withContext('FileProcessingResultPersistence')
const resultsDirWriteQueues = new Map<string, Promise<void>>()

type PersistenceCleanupContext = {
  resultsDir?: string
  tempDir?: string
  backupDir?: string
  tempDownloadDir?: string
  zipFilePath?: string
  step: string
}

async function warnIfCleanupFails(action: () => Promise<void>, context: PersistenceCleanupContext): Promise<void> {
  try {
    await action()
  } catch (error) {
    logger.warn('File processing result persistence cleanup failed', error as Error, context)
  }
}

function normalizeEntryPath(entryName: string): string {
  const posixPath = entryName.replace(/\\/g, '/')

  if (!posixPath || path.posix.isAbsolute(posixPath) || /^[a-zA-Z]:[\\/]/.test(entryName)) {
    throw new Error(`Unsafe zip entry path: ${entryName}`)
  }

  const normalizedPath = path.posix.normalize(posixPath).replace(/^(\.\/)+/, '')

  if (!normalizedPath || normalizedPath === '.' || normalizedPath === '..' || normalizedPath.startsWith('../')) {
    throw new Error(`Unsafe zip entry path: ${entryName}`)
  }

  return normalizedPath
}

function getPersistedMarkdownPath(resultsDir: string): string {
  return path.join(resultsDir, OUTPUT_MARKDOWN_FILE)
}

function stripMarkdownBaseDir(relativePath: string, markdownBaseDir: string): string {
  if (!markdownBaseDir) {
    return relativePath
  }

  const prefix = `${markdownBaseDir}/`
  if (relativePath.startsWith(prefix)) {
    return relativePath.slice(prefix.length)
  }

  return relativePath
}

async function withResultsDirWriteLock<T>(resultsDir: string, action: () => Promise<T>): Promise<T> {
  const previousWrite = resultsDirWriteQueues.get(resultsDir) ?? Promise.resolve()
  let releaseCurrentWrite!: () => void
  const currentWrite = new Promise<void>((resolve) => {
    releaseCurrentWrite = resolve
  })
  const currentWriteTail = previousWrite.then(() => currentWrite)

  resultsDirWriteQueues.set(resultsDir, currentWriteTail)
  await previousWrite

  try {
    return await action()
  } finally {
    releaseCurrentWrite()

    if (resultsDirWriteQueues.get(resultsDir) === currentWriteTail) {
      resultsDirWriteQueues.delete(resultsDir)
    }
  }
}

async function replaceResultsDirAtomically(
  resultsDir: string,
  writer: (tempDir: string) => Promise<void>
): Promise<void> {
  const parentDir = path.dirname(resultsDir)
  const resultsDirName = path.basename(resultsDir)

  await fs.mkdir(parentDir, { recursive: true })

  const tempDir = await fs.mkdtemp(path.join(parentDir, `${resultsDirName}.tmp-`))

  try {
    await writer(tempDir)

    await withResultsDirWriteLock(resultsDir, async () => {
      const backupDir = path.join(parentDir, `${resultsDirName}.bak-${Date.now()}`)
      const hadExistingResults = await pathExists(resultsDir)

      try {
        if (hadExistingResults) {
          await fs.rename(resultsDir, backupDir)
        }

        await fs.rename(tempDir, resultsDir)

        if (hadExistingResults) {
          await fs.rm(backupDir, { recursive: true, force: true })
        }
      } catch (error) {
        const tempDirStillExists = await pathExists(tempDir)

        if (hadExistingResults && !(await pathExists(resultsDir))) {
          await warnIfCleanupFails(() => fs.rename(backupDir, resultsDir), {
            resultsDir,
            tempDir,
            backupDir,
            step: 'restore-backup'
          })
        } else if (hadExistingResults) {
          await warnIfCleanupFails(() => fs.rm(backupDir, { recursive: true, force: true }), {
            resultsDir,
            tempDir,
            backupDir,
            step: 'remove-backup'
          })
        }

        if (tempDirStillExists) {
          await warnIfCleanupFails(() => fs.rm(tempDir, { recursive: true, force: true }), {
            resultsDir,
            tempDir,
            backupDir,
            step: 'remove-temp'
          })
        }

        throw error
      }
    })
  } catch (error) {
    await warnIfCleanupFails(() => fs.rm(tempDir, { recursive: true, force: true }), {
      resultsDir,
      tempDir,
      step: 'remove-temp-after-error'
    })
    throw error
  }
}

export async function persistZipResult(options: { zipFilePath: string; resultsDir: string }): Promise<string> {
  const zip = new StreamZip.async({ file: options.zipFilePath })
  try {
    const entries = Object.values(await zip.entries())
    let markdownRelativePath: string | undefined

    await replaceResultsDirAtomically(options.resultsDir, async (tempDir) => {
      for (const entry of entries) {
        if (!entry.isDirectory) {
          const relativePath = normalizeEntryPath(entry.name)
          if (!markdownRelativePath && relativePath.toLowerCase().endsWith('.md')) {
            markdownRelativePath = relativePath
          }
        }
      }

      if (!markdownRelativePath) {
        throw new Error('Result zip does not contain a markdown file')
      }

      // Current provider contract: the downloaded archive contains a single markdown file.
      // We normalize that provider-specific path to the stable file-processing output name.
      const markdownBaseDir =
        path.posix.dirname(markdownRelativePath) === '.' ? '' : path.posix.dirname(markdownRelativePath)

      for (const entry of entries) {
        const relativePath = normalizeEntryPath(entry.name)
        const outputRelativePath = relativePath.toLowerCase().endsWith('.md')
          ? OUTPUT_MARKDOWN_FILE
          : stripMarkdownBaseDir(relativePath, markdownBaseDir)
        const absolutePath = path.join(tempDir, ...outputRelativePath.split('/'))

        if (entry.isDirectory) {
          await fs.mkdir(absolutePath, { recursive: true })
        } else {
          await fs.mkdir(path.dirname(absolutePath), { recursive: true })
          await zip.extract(entry.name, absolutePath)
        }
      }
    })

    return getPersistedMarkdownPath(options.resultsDir)
  } finally {
    await warnIfCleanupFails(() => zip.close(), {
      resultsDir: options.resultsDir,
      zipFilePath: options.zipFilePath,
      step: 'close-zip'
    })
  }
}

export async function persistResponseZipResult(options: {
  response: Response
  resultsDir: string
  signal?: AbortSignal
}): Promise<string> {
  const parentDir = path.dirname(options.resultsDir)
  const resultsDirName = path.basename(options.resultsDir)

  await fs.mkdir(parentDir, { recursive: true })

  const tempDownloadDir = await fs.mkdtemp(path.join(parentDir, `${resultsDirName}.zip-`))
  const zipFilePath = path.join(tempDownloadDir, 'result.zip')

  try {
    if (!options.response.body) {
      throw new Error('Result download response body is empty')
    }

    const responseStream = Readable.fromWeb(options.response.body as any)
    await pipeline(responseStream, createWriteStream(zipFilePath), { signal: options.signal })

    return await persistZipResult({
      zipFilePath,
      resultsDir: options.resultsDir
    })
  } finally {
    await warnIfCleanupFails(() => fs.rm(tempDownloadDir, { recursive: true, force: true }), {
      resultsDir: options.resultsDir,
      tempDownloadDir,
      zipFilePath,
      step: 'remove-temp-download'
    })
  }
}

export async function persistMarkdownResult(options: { resultsDir: string; markdownContent: string }): Promise<string> {
  await replaceResultsDirAtomically(options.resultsDir, async (tempDir) => {
    await fs.writeFile(path.join(tempDir, OUTPUT_MARKDOWN_FILE), options.markdownContent, 'utf-8')
  })

  return getPersistedMarkdownPath(options.resultsDir)
}
