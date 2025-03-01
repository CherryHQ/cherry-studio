import db from '@renderer/databases'
import { convertToBase64 } from '@renderer/utils'

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
      console.error('Error storing the image', error)
    }
  }

  static async get(key: string): Promise<string> {
    const id = IMAGE_PREFIX + key
    return (await db.settings.get(id))?.value
  }
}
