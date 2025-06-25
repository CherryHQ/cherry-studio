import path from 'path'

import { buildDirectoryTree, createDirectory, listDirectory } from './operations/directoryOperations'
import { applyFileEdits, editBlock } from './operations/editOperations'
import { getFileInfo, moveFile, readFile, readMultipleFiles, writeFile } from './operations/fileOperations'
import { EditOperation, EditResult, FileInfo, FileSystemConfig, SearchResult, ServiceResult, TreeEntry } from './types'
import { expandHome, normalizePath, validateAllowedDirectories, validatePath } from './utils/pathValidation'
import { CodeSearchOptions, searchCode, searchFiles } from './utils/searchUtils'

export class FileSystemService {
  private allowedDirectories: string[]
  private config: FileSystemConfig

  constructor(config: FileSystemConfig) {
    this.config = config
    this.allowedDirectories = config.allowedDirectories.map((dir) => normalizePath(path.resolve(expandHome(dir))))
  }

  async initialize(): Promise<void> {
    await validateAllowedDirectories(this.config.allowedDirectories)
  }

  // File operations
  async readFile(filePath: string): Promise<ServiceResult<string>> {
    try {
      const validPath = await validatePath(this.allowedDirectories, filePath)
      return await readFile(validPath)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async readMultipleFiles(filePaths: string[]): Promise<ServiceResult<Map<string, string>>> {
    const validatedPaths: string[] = []
    const errors: string[] = []

    // Validate all paths first
    for (const filePath of filePaths) {
      try {
        const validPath = await validatePath(this.allowedDirectories, filePath)
        validatedPaths.push(validPath)
      } catch (error) {
        errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (validatedPaths.length === 0) {
      return {
        success: false,
        error: errors.join('\n')
      }
    }

    const result = await readMultipleFiles(validatedPaths)
    if (errors.length > 0 && result.error) {
      result.error = errors.join('\n') + '\n' + result.error
    } else if (errors.length > 0) {
      result.error = errors.join('\n')
    }

    return result
  }

  async writeFile(filePath: string, content: string): Promise<ServiceResult<void>> {
    try {
      const validPath = await validatePath(this.allowedDirectories, filePath)

      // Check file write line limit if configured
      if (this.config.fileWriteLineLimit) {
        const lines = content.split('\n').length
        if (lines > this.config.fileWriteLineLimit) {
          return {
            success: false,
            error: `Content exceeds line limit of ${this.config.fileWriteLineLimit} lines (has ${lines} lines)`
          }
        }
      }

      return await writeFile(validPath, content)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async moveFile(sourcePath: string, destPath: string): Promise<ServiceResult<void>> {
    try {
      const validSourcePath = await validatePath(this.allowedDirectories, sourcePath)
      const validDestPath = await validatePath(this.allowedDirectories, destPath)
      return await moveFile(validSourcePath, validDestPath)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async getFileInfo(filePath: string): Promise<ServiceResult<FileInfo>> {
    try {
      const validPath = await validatePath(this.allowedDirectories, filePath)
      return await getFileInfo(validPath)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  // Directory operations
  async createDirectory(dirPath: string): Promise<ServiceResult<void>> {
    try {
      const validPath = await validatePath(this.allowedDirectories, dirPath)
      return await createDirectory(validPath)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async listDirectory(dirPath: string): Promise<ServiceResult<Array<{ name: string; type: 'file' | 'directory' }>>> {
    try {
      const validPath = await validatePath(this.allowedDirectories, dirPath)
      return await listDirectory(validPath)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async getDirectoryTree(dirPath: string): Promise<ServiceResult<TreeEntry[]>> {
    try {
      const validPath = await validatePath(this.allowedDirectories, dirPath)
      return await buildDirectoryTree(validPath, this.allowedDirectories)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  // Search operations
  async searchFiles(searchPath: string, pattern: string, excludePatterns?: string[]): Promise<ServiceResult<string[]>> {
    try {
      const validPath = await validatePath(this.allowedDirectories, searchPath)
      const results = await searchFiles(this.allowedDirectories, validPath, pattern, excludePatterns)
      return { success: true, data: results }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async searchCode(options: {
    path: string
    pattern: string
    filePattern?: string
    excludePatterns?: string[]
  }): Promise<ServiceResult<SearchResult[]>> {
    try {
      const validPath = await validatePath(this.allowedDirectories, options.path)
      const searchOptions: CodeSearchOptions = {
        ...options,
        path: validPath
      }

      const results = await searchCode(searchOptions)
      const searchResults: SearchResult[] = results.map((r) => ({
        path: r.file,
        lineNumber: r.line,
        lineContent: r.content,
        matchCount: 1
      }))

      return { success: true, data: searchResults }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  // Edit operations
  async editFile(filePath: string, edits: EditOperation[], dryRun = false): Promise<ServiceResult<string>> {
    try {
      const validPath = await validatePath(this.allowedDirectories, filePath)
      return await applyFileEdits(validPath, edits, dryRun)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async editBlock(
    filePath: string,
    searchText: string,
    replaceText: string,
    options: { fuzzy?: boolean; dryRun?: boolean } = {}
  ): Promise<ServiceResult<EditResult>> {
    try {
      const validPath = await validatePath(this.allowedDirectories, filePath)
      return await editBlock(validPath, searchText, replaceText, options)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  // Utility methods
  getAllowedDirectories(): string[] {
    return [...this.allowedDirectories]
  }
}
