import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { normalizeSourceFile } from './semanticId'
import { transformHtml, transformJsx } from './transform'
import type { UiNodeDescriptor } from './types'

const SOURCE_ROOTS = ['src/renderer', 'packages/ui/src']
const EXCLUDED_DIRECTORIES = new Set(['__snapshots__', '__tests__', 'coverage', 'dist', 'node_modules', 'out'])
const EXCLUDED_FILE_PATTERNS = [/\.gen\.[jt]sx?$/, /\.(?:spec|test|stories)\.[jt]sx?$/]

export function isUiSourceFile(file: string): boolean {
  const normalized = file.replaceAll('\\', '/')
  if (!/\.(?:html|jsx|tsx)$/.test(normalized)) return false
  if (normalized.includes('/node_modules/') || normalized.includes('/__tests__/')) return false
  return !EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(normalized))
}

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) files.push(...(await collectFiles(path)))
    } else if (isUiSourceFile(path)) {
      files.push(path)
    }
  }
  return files
}

export function windowNameFromHtml(sourceFile: string): string {
  const parts = sourceFile.replace(/\/index\.html$/, '').split('/')
  const windowIndex = parts.lastIndexOf('windows')
  return (windowIndex >= 0 ? parts.slice(windowIndex + 1) : parts.slice(-2)).join('.') || 'main'
}

export async function scanUiSources(root: string): Promise<UiNodeDescriptor[]> {
  const files = (
    await Promise.all(
      SOURCE_ROOTS.map(async (sourceRoot) => {
        try {
          return await collectFiles(resolve(root, sourceRoot))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
          throw error
        }
      })
    )
  )
    .flat()
    .sort()

  const descriptors: UiNodeDescriptor[] = []
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const sourceFile = normalizeSourceFile(root, file)
    try {
      const result = file.endsWith('.html')
        ? transformHtml(source, { sourceFile, windowName: windowNameFromHtml(sourceFile) })
        : transformJsx(source, { sourceFile })
      descriptors.push(...result.descriptors)
    } catch (error) {
      throw new Error(`Failed to scan UI contract source ${sourceFile}`, { cause: error })
    }
  }
  return descriptors
}
