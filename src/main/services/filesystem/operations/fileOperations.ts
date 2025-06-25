import fs from 'fs/promises'

import { FileInfo, ServiceResult } from '../types'

export async function readFile(filePath: string): Promise<ServiceResult<string>> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return { success: true, data: content }
  } catch (error) {
    return {
      success: false,
      error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

export async function readMultipleFiles(filePaths: string[]): Promise<ServiceResult<Map<string, string>>> {
  const results = new Map<string, string>()
  const errors: string[] = []

  await Promise.all(
    filePaths.map(async (filePath) => {
      const result = await readFile(filePath)
      if (result.success && result.data) {
        results.set(filePath, result.data)
      } else {
        errors.push(`${filePath}: ${result.error}`)
      }
    })
  )

  if (errors.length > 0 && results.size === 0) {
    return { success: false, error: errors.join('\n') }
  }

  return {
    success: true,
    data: results,
    error: errors.length > 0 ? `Some files failed: \n${errors.join('\n')}` : undefined
  }
}

export async function writeFile(filePath: string, content: string): Promise<ServiceResult<void>> {
  try {
    await fs.writeFile(filePath, content, 'utf-8')
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: `Failed to write file: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

export async function moveFile(sourcePath: string, destPath: string): Promise<ServiceResult<void>> {
  try {
    await fs.rename(sourcePath, destPath)
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: `Failed to move file: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

export async function getFileInfo(filePath: string): Promise<ServiceResult<FileInfo>> {
  try {
    const stats = await fs.stat(filePath)
    const info: FileInfo = {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      accessed: stats.atime,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      permissions: stats.mode.toString(8).slice(-3)
    }
    return { success: true, data: info }
  } catch (error) {
    return {
      success: false,
      error: `Failed to get file info: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}
