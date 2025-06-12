import Logger from '@renderer/config/logger'
import { FileType } from '@renderer/types'

export const getFilesFromDropEvent = async (e: React.DragEvent<HTMLDivElement>): Promise<FileType[]> => {
  if (e.dataTransfer.files.length > 0) {
    // 使用新的API获取文件路径
    const filePromises = [...e.dataTransfer.files].map(async (file) => {
      try {
        // 使用新的webUtils.getPathForFile API获取文件路径
        const filePath = window.api.file.getPathForFile(file)
        if (filePath) {
          return window.api.file.get(filePath)
        }
        return null
      } catch (error) {
        Logger.error('[src/renderer/src/utils/input.ts] getFilesFromDropEvent - getPathForFile error:', error)
        return null
      }
    })

    const results = await Promise.allSettled(filePromises)
    const list: FileType[] = []
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value !== null) {
        list.push(result.value)
      } else if (result.status === 'rejected') {
        Logger.error('[src/renderer/src/utils/input.ts] getFilesFromDropEvent:', result.reason)
      }
    }
    return list
  } else {
    return new Promise((resolve) => {
      let existCodefilesFormat = false
      for (const item of e.dataTransfer.items) {
        const { type } = item
        if (type === 'codefiles') {
          item.getAsString(async (filePathListString) => {
            const filePathList: string[] = JSON.parse(filePathListString)
            const filePathListPromises = filePathList.map((filePath) => window.api.file.get(filePath))
            resolve(
              await Promise.allSettled(filePathListPromises).then((results) =>
                results
                  .filter((result) => result.status === 'fulfilled')
                  .filter((result) => result.value !== null)
                  .map((result) => result.value!)
              )
            )
          })

          existCodefilesFormat = true
          break
        }
      }

      if (!existCodefilesFormat) {
        resolve([])
      }
    })
  }
}
