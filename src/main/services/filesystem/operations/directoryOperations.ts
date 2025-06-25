import fs from 'fs/promises'
import path from 'path'

import { ServiceResult, TreeEntry } from '../types'
import { validatePath } from '../utils/pathValidation'

export async function createDirectory(dirPath: string): Promise<ServiceResult<void>> {
  try {
    await fs.mkdir(dirPath, { recursive: true })
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: `Failed to create directory: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

export async function listDirectory(
  dirPath: string
): Promise<ServiceResult<Array<{ name: string; type: 'file' | 'directory' }>>> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const results = entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? ('directory' as const) : ('file' as const)
    }))
    return { success: true, data: results }
  } catch (error) {
    return {
      success: false,
      error: `Failed to list directory: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

export async function buildDirectoryTree(
  dirPath: string,
  allowedDirectories: string[]
): Promise<ServiceResult<TreeEntry[]>> {
  async function buildTree(currentPath: string): Promise<TreeEntry[]> {
    const validPath = await validatePath(allowedDirectories, currentPath)
    const entries = await fs.readdir(validPath, { withFileTypes: true })
    const result: TreeEntry[] = []

    for (const entry of entries) {
      const entryData: TreeEntry = {
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file'
      }

      if (entry.isDirectory()) {
        try {
          const subPath = path.join(currentPath, entry.name)
          entryData.children = await buildTree(subPath)
        } catch (error) {
          // Skip directories we can't access
          entryData.children = []
        }
      }

      result.push(entryData)
    }

    return result
  }

  try {
    const tree = await buildTree(dirPath)
    return { success: true, data: tree }
  } catch (error) {
    return {
      success: false,
      error: `Failed to build directory tree: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}
