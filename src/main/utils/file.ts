import * as fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { isLinux, isPortable } from '@main/constant'
import { audioExts, documentExts, imageExts, textExts, videoExts } from '@shared/config/constant'
import { FileMetadata, FileTypes } from '@types'
import { app } from 'electron'
import Logger from 'electron-log'
import iconv from 'iconv-lite'
import { detect as detectEncoding_, detectAll as detectEncodingAll } from 'jschardet'
import { v4 as uuidv4 } from 'uuid'

export function initAppDataDir() {
  const appDataPath = getAppDataPathFromConfig()
  if (appDataPath) {
    app.setPath('userData', appDataPath)
    return
  }

  if (isPortable) {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
    app.setPath('userData', path.join(portableDir || app.getPath('exe'), 'data'))
    return
  }
}

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

export function hasWritePermission(path: string) {
  try {
    fs.accessSync(path, fs.constants.W_OK)
    return true
  } catch (error) {
    return false
  }
}

function getAppDataPathFromConfig() {
  try {
    const configPath = path.join(getConfigDir(), 'config.json')
    if (!fs.existsSync(configPath)) {
      return null
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))

    if (!config.appDataPath) {
      return null
    }

    let executablePath = app.getPath('exe')
    if (isLinux && process.env.APPIMAGE) {
      // 如果是 AppImage 打包的应用，直接使用 APPIMAGE 环境变量
      // 这样可以确保获取到正确的可执行文件路径
      executablePath = path.join(path.dirname(process.env.APPIMAGE), 'cherry-studio.appimage')
    }

    let appDataPath = null
    // 兼容旧版本
    if (config.appDataPath && typeof config.appDataPath === 'string') {
      appDataPath = config.appDataPath
      // 将旧版本数据迁移到新版本
      appDataPath && updateAppDataConfig(appDataPath)
    } else {
      appDataPath = config.appDataPath.find(
        (item: { executablePath: string }) => item.executablePath === executablePath
      )?.dataPath
    }

    if (appDataPath && fs.existsSync(appDataPath) && hasWritePermission(appDataPath)) {
      return appDataPath
    }

    return null
  } catch (error) {
    return null
  }
}

export function updateAppDataConfig(appDataPath: string) {
  const configDir = getConfigDir()
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  // config.json
  // appDataPath: [{ executablePath: string, dataPath: string }]
  const configPath = path.join(getConfigDir(), 'config.json')
  let executablePath = app.getPath('exe')
  if (isLinux && process.env.APPIMAGE) {
    executablePath = path.join(path.dirname(process.env.APPIMAGE), 'cherry-studio.appimage')
  }

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ appDataPath: [{ executablePath, dataPath: appDataPath }] }, null, 2))
    return
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  if (!config.appDataPath || (config.appDataPath && typeof config.appDataPath !== 'object')) {
    config.appDataPath = []
  }

  const existingPath = config.appDataPath.find(
    (item: { executablePath: string }) => item.executablePath === executablePath
  )

  if (existingPath) {
    existingPath.dataPath = appDataPath
  } else {
    config.appDataPath.push({ executablePath, dataPath: appDataPath })
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
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

/**
 * 使用 jschardet 库检测文件编码格式
 * @param filePath - 文件路径
 * @returns 返回文件的编码格式，如 UTF-8, ascii, GB2312 等
 */
export function detectEncoding(filePath: string): string {
  // 读取文件前1KB来检测编码
  const buffer = Buffer.alloc(1024)
  const fd = fs.openSync(filePath, 'r')
  fs.readSync(fd, buffer, 0, 1024, 0)
  fs.closeSync(fd)
  const { encoding } = detectEncoding_(buffer)
  return encoding
}

/**
 * 读取文件内容并自动检测编码格式进行解码
 * @param filePath - 文件路径
 * @returns 解码后的文件内容
 */
export function readTextFileWithAutoEncoding(filePath: string) {
  const encoding = detectEncoding(filePath)
  const data = fs.readFileSync(filePath)
  const content = iconv.decode(data, encoding)

  if (content.includes('\uFFFD') && encoding !== 'UTF-8') {
    Logger.error(`文件 ${filePath} 自动识别编码为 ${encoding}，但包含错误字符。尝试其他编码`)
    const buffer = Buffer.alloc(1024)
    const fd = fs.openSync(filePath, 'r')
    fs.readSync(fd, buffer, 0, 1024, 0)
    fs.closeSync(fd)
    const encodings = detectEncodingAll(buffer)
    if (encodings.length > 0) {
      for (const item of encodings) {
        if (item.encoding === encoding) {
          continue
        }
        Logger.log(`尝试使用 ${item.encoding} 解码文件 ${filePath}`)
        const content = iconv.decode(buffer, item.encoding)
        if (!content.includes('\uFFFD')) {
          Logger.log(`文件 ${filePath} 解码成功，编码为 ${item.encoding}`)
          return content
        } else {
          Logger.error(`文件 ${filePath} 使用 ${item.encoding} 解码失败，尝试下一个编码`)
        }
      }
    }
    Logger.error(`文件 ${filePath} 所有可能的编码均解码失败，尝试使用 UTF-8 解码`)
    return iconv.decode(buffer, 'UTF-8')
  }

  return content
}
