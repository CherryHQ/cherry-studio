import { FileType } from '@renderer/types'
import Logger from 'electron-log/renderer'

export const getFilesFromDropEvent = async (e: React.DragEvent<HTMLDivElement>): Promise<FileType[]> => {
  if (e.dataTransfer.files.length > 0) {
    // 使用Array.from而不是扩展操作符
    const results = await Promise.allSettled(
      Array.from(e.dataTransfer.files).map((file) => window.api.file.get(file.path))
    )
    const list: FileType[] = []
    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (result.value !== null) {
          list.push(result.value)
        }
      } else {
        Logger.error('[src/renderer/src/utils/input.ts] getFilesFromDropEvent:', result.reason)
      }
    }
    return list
  } else {
    return new Promise((resolve) => {
      let existCodefilesFormat = false
      // 使用Array.from转换DataTransferItemList
      const items = Array.from(e.dataTransfer.items)
      for (const item of items) {
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
