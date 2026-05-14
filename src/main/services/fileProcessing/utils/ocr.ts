import { readFile } from 'node:fs/promises'

import type { FileInfo } from '@shared/file/types'

const preprocessImage = async (buffer: Buffer): Promise<Buffer> => {
  // Delayed loading: Sharp is only loaded when file processing OCR needs it.
  const sharp = (await import('sharp')).default
  return sharp(buffer).grayscale().normalize().sharpen().png({ quality: 100 }).toBuffer()
}

export const loadFileProcessingOcrImage = async (file: Pick<FileInfo, 'path'>): Promise<Buffer> => {
  const buffer = await readFile(file.path)
  return preprocessImage(buffer)
}
