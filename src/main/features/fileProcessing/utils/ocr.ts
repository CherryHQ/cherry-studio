import type { FileInfo } from '@shared/types/file'
import { readFile } from 'fs/promises'

const preprocessImage = async (buffer: Buffer): Promise<Buffer> => {
  const sharp = (await import('sharp')).default
  return sharp(buffer).grayscale().normalize().sharpen().png({ quality: 100 }).toBuffer()
}

export const loadOcrImage = async (file: FileInfo): Promise<Buffer> => {
  const buffer = await readFile(file.path)
  return preprocessImage(buffer)
}
