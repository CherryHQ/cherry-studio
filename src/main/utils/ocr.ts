import { ImageFileMetadata } from '@types'
import { readFile } from 'fs/promises'

import { greyScale } from './image'

const preprocessImage = (buffer: Buffer) => {
  return greyScale(buffer)
}

/**
 * 加载并预处理OCR图像
 * @param file - 图像文件元数据
 * @returns 预处理后的图像Buffer
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
