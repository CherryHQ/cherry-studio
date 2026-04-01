import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { pathExists } from '@main/utils/file'
import StreamZip from 'node-stream-zip'

export const OUTPUT_MARKDOWN_FILE = 'output.md'
const LOCK_RETRY_DELAY_MS = 50
const LOCK_MAX_RETRIES = 50

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

async function withResultsDirLock<T>(resultsDir: string, action: () => Promise<T>): Promise<T> {
  const lockFilePath = `${resultsDir}.lock`

  for (let attempt = 0; attempt <= LOCK_MAX_RETRIES; attempt += 1) {
    try {
      const handle = await fs.open(lockFilePath, 'wx')
      await handle.close()

      try {
        return await action()
      } finally {
        await fs.rm(lockFilePath, { force: true }).catch(() => undefined)
      }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException

      if (nodeError.code !== 'EEXIST' || attempt >= LOCK_MAX_RETRIES) {
        throw error
      }

      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS))
    }
  }

  throw new Error(`Failed to acquire file processing results lock for ${resultsDir}`)
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

    await withResultsDirLock(resultsDir, async () => {
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
          await fs.rename(backupDir, resultsDir).catch(() => undefined)
        } else if (hadExistingResults) {
          await fs.rm(backupDir, { recursive: true, force: true }).catch(() => undefined)
        }

        if (tempDirStillExists) {
          await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
        }

        throw error
      }
    })
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
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
    await zip.close().catch(() => undefined)
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
    await fs.rm(tempDownloadDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function persistMarkdownResult(options: { resultsDir: string; markdownContent: string }): Promise<string> {
  await replaceResultsDirAtomically(options.resultsDir, async (tempDir) => {
    await fs.writeFile(path.join(tempDir, OUTPUT_MARKDOWN_FILE), options.markdownContent, 'utf-8')
  })

  return getPersistedMarkdownPath(options.resultsDir)
}
