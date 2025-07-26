import { loggerService } from '@logger'
import db from '@renderer/databases'
import { convertToBase64 } from '@renderer/utils'

const logger = loggerService.withContext('ImageStorage')

const IMAGE_PREFIX = 'image://'

export default class ImageStorage {
  static async set(key: string, value: File | string) {
    const id = IMAGE_PREFIX + key
    try {
      if (typeof value === 'string') {
        // string（emoji）
        if (await db.settings.get(id)) {
          db.settings.update(id, { value })
          return
        }
        await db.settings.add({ id, value })
      } else {
        // file image
        const base64Image = await convertToBase64(value)
        if (typeof base64Image === 'string') {
          if (await db.settings.get(id)) {
            db.settings.update(id, { value: base64Image })
            return
          }
          await db.settings.add({ id, value: base64Image })
        }
      }
    } catch (error) {
      logger.error('Error storing the image', error as Error)
    }
  }

  static async get(key: string): Promise<string> {
    const id = IMAGE_PREFIX + key
    return (await db.settings.get(id))?.value
  }

  static async remove(key: string): Promise<void> {
    const id = IMAGE_PREFIX + key
    try {
      const record = await db.settings.get(id)
      if (record) {
        await db.settings.delete(id)
      }
    } catch (error) {
      logger.error('Error removing the image', error as Error)
      throw error
    }
  }
}
