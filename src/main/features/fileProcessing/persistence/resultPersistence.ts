import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { loggerService } from '@logger'
import StreamZip from 'node-stream-zip'

const logger = loggerService.withContext('FileProcessingResultPersistence')

type PersistenceCleanupContext = {
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
  if (!entryName || path.posix.isAbsolute(entryName) || /^[a-zA-Z]:[\\/]/.test(entryName) || entryName.includes('\\')) {
    throw new Error(`Unsafe zip entry path: ${entryName}`)
  }

  const normalizedPath = path.posix.normalize(entryName).replace(/^(\.\/)+/, '')

  if (!normalizedPath || normalizedPath === '.' || normalizedPath === '..' || normalizedPath.startsWith('../')) {
    throw new Error(`Unsafe zip entry path: ${entryName}`)
  }

  return normalizedPath
}

export async function readMarkdownFromZipFile(zipFilePath: string): Promise<Uint8Array> {
  const zip = new StreamZip.async({ file: zipFilePath })
  try {
    const entries = Object.values(await zip.entries())
    let markdownEntry: StreamZip.ZipEntry | undefined
    for (const entry of entries) {
      if (entry.isDirectory) {
        continue
      }
      const entryName = entry.name.toLowerCase()
      if (!entryName.endsWith('.md') && !entryName.includes('.md\\')) {
        continue
      }
      const relativePath = normalizeEntryPath(entry.name)
      if (relativePath.toLowerCase().endsWith('.md')) {
        markdownEntry = entry
        break
      }
    }

    if (!markdownEntry) {
      throw new Error('Result zip does not contain a markdown file')
    }

    return new Uint8Array(await zip.entryData(markdownEntry))
  } finally {
    await warnIfCleanupFails(() => zip.close(), {
      zipFilePath,
      step: 'close-zip'
    })
  }
}

export async function readMarkdownFromResponseZip(options: {
  response: Response
  tempDir: string
  signal?: AbortSignal
}): Promise<Uint8Array> {
  await fs.mkdir(options.tempDir, { recursive: true })

  const tempDownloadDir = await fs.mkdtemp(path.join(options.tempDir, 'file-processing-result-'))
  const zipFilePath = path.join(tempDownloadDir, 'result.zip')

  try {
    if (!options.response.body) {
      throw new Error('Result download response body is empty')
    }

    const responseStream = Readable.fromWeb(options.response.body as any)
    await pipeline(responseStream, createWriteStream(zipFilePath), { signal: options.signal })

    return await readMarkdownFromZipFile(zipFilePath)
  } finally {
    await warnIfCleanupFails(() => fs.rm(tempDownloadDir, { recursive: true, force: true }), {
      tempDownloadDir,
      zipFilePath,
      step: 'remove-temp-download'
    })
  }
}
