import * as fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { isPortable } from '@main/constant'
import { audioExts, documentExts, imageExts, textExts, videoExts } from '@shared/config/constant'
import { FileType, FileTypes } from '@types'
import { app } from 'electron'
import { v4 as uuidv4 } from 'uuid'

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

function getAppDataPathFromConfig() {
  const configPath = path.join(getConfigDir(), 'config.json')
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    if (config.appDataPath) {
      return config.appDataPath
    }
  }
  return null
}

export function initUserDataDir() {
  const appDataPath = getAppDataPathFromConfig()
  if (appDataPath) {
    app.setPath('userData', appDataPath)
    return
  }

  if (isPortable) {
    app.setPath('userData', path.join(path.dirname(app.getPath('exe')), 'data'))
    return
  }
}

export function getDataPath() {
  return path.join(app.getPath('userData'), 'Data')
}

export function writeUserDataPathToConfig(userDataPath: string) {
  const configDir = getConfigDir()
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  const configPath = path.join(getConfigDir(), 'config.json')
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ appDataPath: userDataPath }, null, 2))
    return
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  config.appDataPath = userDataPath
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

export function getFileType(ext: string): FileTypes {
  ext = ext.toLowerCase()
  return fileTypeMap.get(ext) || FileTypes.OTHER
}

export function getAllFiles(dirPath: string, arrayOfFiles: FileType[] = []): FileType[] {
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

      const fileItem: FileType = {
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
  console.log('getFilesDir', app.getPath('userData'))

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

export async function copyUserDataToNewLocation(
  sourcePath: string,
  targetPath: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Create target directory if it doesn't exist
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true })
    }

    // Check if source and target are the same
    if (path.resolve(sourcePath) === path.resolve(targetPath)) {
      return { success: true }
    }

    // Copy files and directories recursively
    await copyFolderRecursive(sourcePath, targetPath)

    return { success: true }
  } catch (error: any) {
    console.error('Error copying user data:', error)
    return {
      success: false,
      error: error?.message || 'Failed to copy data to new location'
    }
  }
}

async function copyFolderRecursive(source: string, target: string): Promise<void> {
  // Create target folder if it doesn't exist
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true })
  }

  // Get all files and directories in the source folder
  const entries = fs.readdirSync(source, { withFileTypes: true })

  // Process each entry
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name)
    const targetPath = path.join(target, entry.name)

    if (entry.isDirectory()) {
      // Skip node_modules and other large directories that shouldn't be copied
      if (['node_modules', '.git', 'Cache'].includes(entry.name)) {
        continue
      }

      // Recursively copy the directory
      await copyFolderRecursive(sourcePath, targetPath)
    } else {
      // Skip temp files and logs
      if (entry.name.startsWith('.') || entry.name.endsWith('.log')) {
        continue
      }

      // Copy the file
      fs.copyFileSync(sourcePath, targetPath)
    }
  }
}
