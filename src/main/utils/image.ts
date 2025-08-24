import sharp from 'sharp'

/**
 * 将图片转换为灰度图
 * @param image 输入的图片 Buffer
 * @returns Promise<Buffer> 处理后的灰度图片 Buffer
 * @throws {Error} 当图片处理失败时抛出错误
 */
export const greyScale = (image: Buffer): Promise<Buffer> => {
  return sharp(image).greyscale().toBuffer()
}
