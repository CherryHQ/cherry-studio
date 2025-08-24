import { ImageFileMetadata } from '@types'
import { readFile } from 'fs/promises'
import sharp from 'sharp'

const preprocessImage = (buffer: Buffer) => {
  // threshold 70 is hard-encoded
  const result = sharp(buffer).greyscale().normalise().threshold(70).toBuffer()
  return result
}

/**
 * 加载并预处理OCR图像
 * @param file - 图像文件元数据
 * @returns 预处理后的图像Buffer
 * @throws {Error} 当文件不存在或无法读取时抛出错误；当图像预处理失败时抛出错误
 *
 * 预处理步骤:
 * 1. 读取图像文件
 * 2. 转换为灰度图
 * 3. 后续可扩展其他预处理步骤
 */
export const loadOcrImage = async (file: ImageFileMetadata): Promise<Buffer> => {
  // 读取原始图像
  const buffer = await readFile(file.path)

  // 统一预处理流程
  return preprocessImage(buffer)
}
