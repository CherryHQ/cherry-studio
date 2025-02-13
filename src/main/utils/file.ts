import * as fs from 'node:fs'
import path from 'node:path'

import { audioExts, documentExts, imageExts, textExts, videoExts } from '@shared/config/constant'
import { FileType, FileTypes } from '@types'
import { v4 as uuidv4 } from 'uuid'

export function getFileType(ext: string): FileTypes {
  ext = ext.toLowerCase()
  if (imageExts.includes(ext)) return FileTypes.IMAGE
  if (videoExts.includes(ext)) return FileTypes.VIDEO
  if (audioExts.includes(ext)) return FileTypes.AUDIO
  if (textExts.includes(ext)) return FileTypes.TEXT
  if (documentExts.includes(ext)) return FileTypes.DOCUMENT
  return FileTypes.OTHER
}
export function getAllFiles(dirPath: string, arrayOfFiles: FileType[] = []): FileType[] {
  const files = fs.readdirSync(dirPath)

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file)
    if (fs.statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllFiles(fullPath, arrayOfFiles)
    } else {
      const ext = path.extname(file)
      const fileType = getFileType(ext)

      if (fileType === FileTypes.OTHER) return

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
        created_at: new Date()
      }
      arrayOfFiles.push(fileItem)
    }
  })

  return arrayOfFiles
}
