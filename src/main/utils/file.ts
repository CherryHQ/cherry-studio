import * as fs from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { loggerService } from '@logger'
import { audioExts, documentExts, imageExts, MB, textExts, videoExts } from '@shared/config/constant'
import { FileMetadata, FileTypes, NotesTreeNode } from '@types'
import chardet from 'chardet'
import { app } from 'electron'
import iconv from 'iconv-lite'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('Utils:File')

// 创建文件类型映射表，提高查找效率
const fileTypeMap = new Map<string, FileTypes>()

// 初始化映射表
function initFileTypeMap() {
  imageExts.forEach((ext) => fileTypeMap.set(ext, FileTypes.IMAGE))
  videoExts.forEach((ext) => fileTypeMap.set(ext, FileTypes.VIDEO))
  audioExts.forEach((ext) => fileTypeMap.set(ext, FileTypes.AUDIO))
  textExts.forEach((ext) => fileTypeMap.set(ext, FileTypes.TEXT))
  documentExts.forEach((ext) => fileTypeMap.set(ext, FileTypes.DOCUMENT))
}

// 初始化映射表
initFileTypeMap()

export function untildify(pathWithTilde: string) {
  if (pathWithTilde.startsWith('~')) {
    const homeDirectory = os.homedir()
    return pathWithTilde.replace(/^~(?=$|\/|\\)/, homeDirectory)
  }
  return pathWithTilde
}

export async function hasWritePermission(dir: string) {
  try {
    logger.info(`Checking write permission for ${dir}`)
    await fs.promises.access(dir, fs.constants.W_OK)
    return true
  } catch (error) {
    return false
  }
}

/**
 * Check if a path is inside another path (proper parent-child relationship)
 * This function correctly handles edge cases that string.startsWith() cannot handle,
 * such as distinguishing between '/root/test' and '/root/test aaa'
 *
 * @param childPath - The path that might be inside the parent path
 * @param parentPath - The path that might contain the child path
 * @returns true if childPath is inside parentPath, false otherwise
 */
export function isPathInside(childPath: string, parentPath: string): boolean {
  try {
    const resolvedChild = path.resolve(childPath)
    const resolvedParent = path.resolve(parentPath)

    // Normalize paths to handle different separators
    const normalizedChild = path.normalize(resolvedChild)
    const normalizedParent = path.normalize(resolvedParent)

    // Check if they are the same path
    if (normalizedChild === normalizedParent) {
      return true
    }

    // Get relative path from parent to child
    const relativePath = path.relative(normalizedParent, normalizedChild)

    // If relative path is empty, they are the same
    // If relative path starts with '..', child is not inside parent
    // If relative path is absolute, child is not inside parent
    return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
  } catch (error) {
    logger.error('Failed to check path relationship:', error as Error)
    return false
  }
}

export function getFileType(ext: string): FileTypes {
  ext = ext.toLowerCase()
  return fileTypeMap.get(ext) || FileTypes.OTHER
}

export function getFileDir(filePath: string) {
  return path.dirname(filePath)
}

export function getFileName(filePath: string) {
  return path.basename(filePath)
}

export function getFileExt(filePath: string) {
  return path.extname(filePath)
}

export function getAllFiles(dirPath: string, arrayOfFiles: FileMetadata[] = []): FileMetadata[] {
  const files = fs.readdirSync(dirPath)

  files.forEach((file) => {
    if (file.startsWith('.')) {
      return
    }

    const fullPath = path.join(dirPath, file)
    if (fs.statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllFiles(fullPath, arrayOfFiles)
    } else {
      const ext = path.extname(file)
      const fileType = getFileType(ext)

      if ([FileTypes.OTHER, FileTypes.IMAGE, FileTypes.VIDEO, FileTypes.AUDIO].includes(fileType)) {
        return
      }

      const name = path.basename(file)
      const size = fs.statSync(fullPath).size

      const fileItem: FileMetadata = {
        id: uuidv4(),
        name,
        path: fullPath,
        size,
        ext,
        count: 1,
        origin_name: name,
        type: fileType,
        created_at: new Date().toISOString()
      }

      arrayOfFiles.push(fileItem)
    }
  })

  return arrayOfFiles
}

export function getTempDir() {
  return path.join(app.getPath('temp'), 'CherryStudio')
}

export function getFilesDir() {
  return path.join(app.getPath('userData'), 'Data', 'Files')
}

export function getNotesDir() {
  const notesDir = path.join(app.getPath('userData'), 'Data', 'Notes')
  if (!fs.existsSync(notesDir)) {
    fs.mkdirSync(notesDir, { recursive: true })
    logger.info(`Notes directory created at: ${notesDir}`)
  }
  return notesDir
}

export function getConfigDir() {
  return path.join(os.homedir(), '.cherrystudio', 'config')
}

export function getCacheDir() {
  return path.join(app.getPath('userData'), 'Cache')
}

export function getAppConfigDir(name: string) {
  return path.join(getConfigDir(), name)
}

export function getMcpDir() {
  return path.join(os.homedir(), '.cherrystudio', 'mcp')
}

/**
 * 读取文件内容并自动检测编码格式进行解码
 * @param filePath - 文件路径
 * @returns 解码后的文件内容
 */
export async function readTextFileWithAutoEncoding(filePath: string): Promise<string> {
  const encoding = (await chardet.detectFile(filePath, { sampleSize: MB })) || 'UTF-8'
  logger.debug(`File ${filePath} detected encoding: ${encoding}`)

  const encodings = [encoding, 'UTF-8']
  const data = await readFile(filePath)

  for (const encoding of encodings) {
    try {
      const content = iconv.decode(data, encoding)
      if (!content.includes('\uFFFD')) {
        return content
      } else {
        logger.warn(
          `File ${filePath} was auto-detected as ${encoding} encoding, but contains invalid characters. Trying other encodings`
        )
      }
    } catch (error) {
      logger.error(`Failed to decode file ${filePath} with encoding ${encoding}: ${error}`)
    }
  }

  logger.error(`File ${filePath} failed to decode with all possible encodings, trying UTF-8 encoding`)
  return iconv.decode(data, 'UTF-8')
}

/**
 * 递归扫描目录，获取符合条件的文件和目录结构
 * @param dirPath 当前要扫描的路径
 * @returns 文件元数据数组
 */
export async function scanDir(dirPath: string): Promise<NotesTreeNode[]> {
  const options = {
    includeFiles: true,
    includeDirectories: true,
    fileExtensions: ['.md'],
    ignoreHiddenFiles: true,
    recursive: false,
    maxDepth: undefined
  }
  const depth = 0

  if (options.maxDepth !== undefined && depth > options.maxDepth) {
    return []
  }

  if (!fs.existsSync(dirPath)) {
    loggerService.withContext('Utils:File').warn(`Dir not exist: ${dirPath}`)
    return []
  }

  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
  const result: NotesTreeNode[] = []
  logger.debug('Config', { entries, options })

  for (const entry of entries) {
    if (options.ignoreHiddenFiles && entry.name.startsWith('.')) {
      continue
    }

    const entryPath = path.join(dirPath, entry.name)

    if (entry.isDirectory() && options.includeDirectories) {
      const stats = await fs.promises.stat(entryPath)
      const dirTreeNode: NotesTreeNode = {
        id: uuidv4(),
        name: entry.name,
        treePath: path.relative(dirPath, entryPath),
        externalPath: entryPath,
        createdAt: stats.birthtime.toISOString(),
        updatedAt: stats.mtime.toISOString(),
        type: 'folder'
      }
      result.push(dirTreeNode)
    } else if (entry.isFile() && options.includeFiles) {
      const ext = path.extname(entry.name).toLowerCase()
      if (options.fileExtensions.length > 0 && !options.fileExtensions.includes(ext)) {
        continue
      }

      const stats = await fs.promises.stat(entryPath)
      const name = entry.name.endsWith(options.fileExtensions[0])
        ? entry.name.slice(0, -options.fileExtensions[0].length)
        : entry.name
      const fileTreeNode: NotesTreeNode = {
        id: uuidv4(),
        name: name,
        treePath: path.relative(dirPath, entryPath),
        externalPath: entryPath,
        createdAt: stats.birthtime.toISOString(),
        updatedAt: stats.mtime.toISOString(),
        type: 'file'
      }
      result.push(fileTreeNode)
    }
  }

  return result
}

/**
 * 文件名唯一性约束
 * @param baseDir
 * @param fileName
 * @param isFile
 * @returns 唯一的文件名
 */
export function getName(baseDir: string, fileName: string, isFile: boolean): string {
  const baseName = fileName.replace(/\d+$/, '')
  let candidate = isFile ? baseName + '.md' : baseName
  let counter = 1

  while (fs.existsSync(path.join(baseDir, candidate))) {
    candidate = isFile ? `${baseName}${counter}.md` : `${baseName}${counter}`
    counter++
  }

  return isFile ? candidate.slice(0, -3) : candidate
}

/**
 * 文件名合法性校验
 * @param fileName
 */
export function checkName(fileName: string): string {
  const invalidPattern = /[<>:"/\\|?*]/
  if (invalidPattern.test(fileName)) {
    throw new Error(`Invalid file name: ${fileName}`)
  }

  return fileName
}
