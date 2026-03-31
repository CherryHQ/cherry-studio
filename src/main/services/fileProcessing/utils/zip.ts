import fs from 'node:fs/promises'
import path from 'node:path'

import AdmZip from 'adm-zip'

const OUTPUT_MARKDOWN_FILE = 'output.md'

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

export async function readPersistedMarkdownPath(resultsDir: string): Promise<string | undefined> {
  const markdownPath = getPersistedMarkdownPath(resultsDir)
  const exists = await fs
    .access(markdownPath)
    .then(() => true)
    .catch(() => false)

  if (!exists) {
    return undefined
  }

  return markdownPath
}

export async function persistZipResult(options: {
  zipBuffer: Buffer
  resultsDir: string
  isMarkdownEntry: (entryName: string) => boolean
}): Promise<string> {
  const zip = new AdmZip(options.zipBuffer)
  const entries = zip.getEntries()
  let markdownRelativePath: string | undefined

  for (const entry of entries) {
    if (entry.isDirectory) {
      continue
    }

    const relativePath = normalizeEntryPath(entry.entryName)
    if (!markdownRelativePath && options.isMarkdownEntry(relativePath)) {
      markdownRelativePath = relativePath
    }
  }

  if (!markdownRelativePath) {
    throw new Error('Result zip does not contain a markdown file')
  }

  const markdownBaseDir =
    path.posix.dirname(markdownRelativePath) === '.' ? '' : path.posix.dirname(markdownRelativePath)

  await fs.mkdir(options.resultsDir, { recursive: true })

  for (const entry of entries) {
    const relativePath = normalizeEntryPath(entry.entryName)
    const outputRelativePath = options.isMarkdownEntry(relativePath)
      ? OUTPUT_MARKDOWN_FILE
      : stripMarkdownBaseDir(relativePath, markdownBaseDir)
    const absolutePath = path.join(options.resultsDir, ...outputRelativePath.split('/'))

    if (entry.isDirectory) {
      await fs.mkdir(absolutePath, { recursive: true })
      continue
    }

    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, entry.getData())
  }

  return getPersistedMarkdownPath(options.resultsDir)
}
