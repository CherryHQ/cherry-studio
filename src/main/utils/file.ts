import * as fs from 'node:fs'
import { open, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { loggerService } from '@logger'
import { audioExts, documentExts, imageExts, MB, textExts, videoExts } from '@shared/config/constant'
import { FileMetadata, FileTypes } from '@types'
import { app } from 'electron'
import iconv from 'iconv-lite'
import * as jschardet from 'jschardet'
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
  // 读取前1MB以检测编码
  const buffer = Buffer.alloc(1 * MB)
  const fh = await open(filePath, 'r')
  const { buffer: bufferRead } = await fh.read(buffer, 0, 1 * MB, 0)
  await fh.close()

  // 获取文件编码格式，最多取前两个可能的编码
  const encodings = jschardet
    .detectAll(bufferRead)
    .map((item) => ({
      ...item,
      encoding: item.encoding === 'ascii' ? 'UTF-8' : item.encoding
    }))
    .filter((item, index, array) => array.findIndex((prevItem) => prevItem.encoding === item.encoding) === index)
    .slice(0, 2)

  if (encodings.length === 0) {
    logger.error('Failed to detect encoding. Use utf-8 to decode.')
    const data = await readFile(filePath)
    return iconv.decode(data, 'UTF-8')
  }

  const data = await readFile(filePath)

  for (const item of encodings) {
    const encoding = item.encoding
    const content = iconv.decode(data, encoding)
    if (content.includes('\uFFFD')) {
      logger.error(
        `File ${filePath} was auto-detected as ${encoding} encoding, but contains invalid characters. Trying other encodings`
      )
    } else {
      return content
    }
  }

  logger.error(`File ${filePath} failed to decode with all possible encodings, trying UTF-8 encoding`)
  return iconv.decode(data, 'UTF-8')
}
