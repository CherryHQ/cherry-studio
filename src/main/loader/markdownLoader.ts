import { BaseLoader, ImageArea } from '@cherrystudio/embedjs-interfaces'
import { cleanString, splitTextWithOffsets, truncateCenterString } from '@cherrystudio/embedjs-utils'
import createDebugMessages from 'debug'
import Logger from 'electron-log'
import md5 from 'md5'

export class MarkdownLoader extends BaseLoader<{ type: 'MarkdownLoader' }> {
  private readonly debug = createDebugMessages('embedjs:loader:MarkdownLoader')
  private readonly text: string
  private readonly imageAreas: ImageArea[] // 新增：存储图片区域信息
  constructor({
    text,
    imageAreas = [], // 新增：接收图片区域数组，默认为空
    chunkSize,
    chunkOverlap
  }: {
    text: string
    imageAreas?: ImageArea[] // 可选参数
    chunkSize?: number
    chunkOverlap?: number
  }) {
    // 注意：修改了元数据类型以包含可选的图片信息
    super(`MarkdownLoader_${md5(text)}`, { text }, chunkSize ?? 1000, chunkOverlap ?? 0)
    this.text = text
    this.imageAreas = imageAreas // 存储传入的图片区域
    this.debug(`Initialized MarkdownLoader with ${this.imageAreas.length} image areas.`)
  }

  override async *getUnfilteredChunks() {
    const tuncatedObjectString = truncateCenterString(this.text, 50)
    this.debug('Starting chunk generation...')
    Logger.info('###### MarkdownLoader getUnfilteredChunks ######')
    try {
      // 1. 使用辅助方法获取带偏移量的块
      const chunksWithOffsets = await splitTextWithOffsets(cleanString(this.text), this.chunkSize, this.chunkOverlap)
      // 2. 遍历带偏移量的块，并检查与图片区域的重叠
      for (const chunk of chunksWithOffsets) {
        const chunkMetadata: { type: 'MarkdownLoader'; source: string; images?: string[] } = {
          type: 'MarkdownLoader' as const,
          source: tuncatedObjectString
        }
        const overlappingImagePaths: string[] = []
        // 检查当前块是否与任何图片区域重叠
        for (const area of this.imageAreas) {
          const chunkStart = chunk.startOffset
          const chunkEnd = chunk.endOffset
          const areaStart = area.areaPosition.startOffset
          const areaEnd = area.areaPosition.endOffset
          // 重叠条件：max(start1, start2) < min(end1, end2)
          const overlaps = Math.max(chunkStart, areaStart) < Math.min(chunkEnd, areaEnd)
          if (overlaps) {
            overlappingImagePaths.push(area.url)
          }
        }
        // 如果有重叠，添加元数据
        if (overlappingImagePaths.length > 0) {
          chunkMetadata.images = overlappingImagePaths

          Logger.info({
            message: `Chunk with images found`,
            chunk: chunk.text,
            metadata: chunkMetadata
          })
          this.debug(
            `Chunk starting at offset ${chunk.startOffset} overlaps with images: ${overlappingImagePaths.join(', ')}`
          )
        }
        // 3. Yield 最终的 Document 对象
        yield {
          pageContent: chunk.text,
          metadata: chunkMetadata
        }
      }
      this.debug(`MarkdownLoader processing finished for source '${tuncatedObjectString}'`)
    } catch (e: any) {
      console.log('MarkdownLoader error', e)
      this.debug(`Error during chunk generation for source '${tuncatedObjectString}':`, e.message, e.stack)
      // 可以选择抛出错误或继续处理（如果适用）
      // throw e;
    }
  }
}
